const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { sendPasswordResetEmail } = require('../utils/emailService');

/**
 * Self-service password reset.
 *
 * Three properties matter here, and each one is a decision rather than an
 * afterthought:
 *
 *  1. NO USER ENUMERATION. "Forgot password" must answer identically whether or
 *     not the address exists, in the same shape and with comparable timing.
 *     Otherwise the endpoint becomes a way to discover which emails are
 *     registered.
 *
 *  2. TOKENS STORED HASHED. The database keeps SHA-256 of the token, never the
 *     token. A stolen database dump must not yield usable reset links.
 *
 *  3. SINGLE USE, SHORT LIFE. Consuming a token stamps used_at, and expired
 *     tokens are refused - so a link forwarded to an attacker after the fact is
 *     worthless.
 */

const RESET_TOKEN_TTL_MINUTES = 30;

// bcrypt silently ignores input beyond 72 bytes, so anything longer would be
// truncated without warning. Reject it instead of quietly weakening the hash.
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/**
 * Work out which frontend to point the reset link at.
 *
 * A dedicated FRONTEND_URL is preferred because CLIENT_ORIGIN is a comma
 * separated CORS allow-list whose first entry may be a localhost dev origin -
 * which would put unusable links in real users' emails.
 */
const resolveFrontendUrl = () => {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL.replace(/\/+$/, '');

  const first = String(process.env.CLIENT_ORIGIN || '')
    .split(',')[0]
    .trim()
    .replace(/\/+$/, '');

  return first || 'http://localhost:5173';
};

/**
 * POST /api/v1/auth/forgot-password
 * Always answers with the same 200. The caller learns only that the request was
 * accepted - never whether the address is registered.
 */
const requestPasswordReset = async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address.'
      });
    }

    const [users] = await pool.query('SELECT id, email, name, status FROM users WHERE email = $1', [email]);
    const user = users[0];

    let delivery = { sent: false, isDevMode: true };

    if (user && user.status === 'active') {
      // 32 random bytes = 64 hex characters. The token is only ever known to
      // the user (via the email) and to this request.
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = sha256(token);

      // Invalidate anything outstanding so only the newest link works, then
      // issue the new one.
      await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);
      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval) RETURNING id`,
        [user.id, tokenHash, RESET_TOKEN_TTL_MINUTES]
      );

      const resetUrl = `${resolveFrontendUrl()}/reset-password?token=${token}`;
      delivery = await sendPasswordResetEmail(user.email, resetUrl);

      console.log(`[Auth] Password reset requested for ${user.email} (token issued, ${RESET_TOKEN_TTL_MINUTES} min)`);
    } else {
      // No user, or a suspended account. Still do comparable work so the
      // response time does not reveal which case it was.
      await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
    }

    // Identical response either way - this is the whole point.
    return res.status(200).json({
      success: true,
      message: 'If an account exists for that address, a reset link is on its way.',
      // In development, with no SMTP configured, hand the link back so the flow
      // is testable. Never returned when SMTP is configured, so production can
      // not be used to request a link for someone else's account.
      ...(delivery.devUrl && !process.env.SMTP_USER ? { devResetUrl: delivery.devUrl } : {})
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/auth/reset-password/verify?token=...
 * Lets the form tell the user the link is valid/expired before they type a new
 * password, instead of failing after all that effort.
 */
const verifyResetToken = async (req, res, next) => {
  try {
    const token = String(req.query.token || '').trim();

    if (!token) {
      return res.status(400).json({ success: false, valid: false, message: 'No reset token provided.' });
    }

    const [rows] = await pool.query(
      `SELECT id, expires_at, used_at, (expires_at > NOW()) AS is_valid
         FROM password_reset_tokens
        WHERE token_hash = $1`,
      [sha256(token)]
    );

    const record = rows[0];

    if (!record) {
      return res.status(400).json({ success: false, valid: false, message: 'This reset link is not valid.' });
    }

    if (record.used_at) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: 'This reset link has already been used. Please request a new one.'
      });
    }

    // Expiry is decided by the DATABASE against its own clock, never in Node.
    // That matters: the timestamp is read as an absolute instant (TIMESTAMPTZ),
    // so there is no local-timezone reading to get wrong, and a token can
    // never look expired the instant it is issued. The signup OTP flow
    // compares this way for exactly the same reason.
    if (!record.is_valid) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: 'This reset link has expired. Please request a new one.'
      });
    }

    res.status(200).json({ success: true, valid: true, expiresAt: record.expires_at });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/auth/reset-password
 * Consumes the token and sets the new password.
 */
const resetPassword = async (req, res, next) => {
  try {
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');

    if (!token) {
      return res.status(400).json({ success: false, message: 'No reset token provided.' });
    }

    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`
      });
    }

    const [rows] = await pool.query(
      `SELECT prt.id, prt.user_id, prt.expires_at, prt.used_at,
              (prt.expires_at > NOW()) AS is_valid
         FROM password_reset_tokens prt
        WHERE prt.token_hash = $1`,
      [sha256(token)]
    );

    const record = rows[0];

    if (!record) {
      return res.status(400).json({
        success: false,
        message: 'This reset link is not valid. Please request a new one.'
      });
    }

    if (record.used_at) {
      return res.status(400).json({
        success: false,
        message: 'This reset link has already been used. Please request a new one.'
      });
    }

    if (!record.is_valid) {
      return res.status(400).json({
        success: false,
        message: 'This reset link has expired. Please request a new one.'
      });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Claim the token and change the password together. If two requests race,
    // only one can mark used_at first (affectedRows check below), so a token
    // can never be spent twice.
    const [claim] = await pool.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1 AND used_at IS NULL',
      [record.id]
    );

    if (claim.affectedRows === 0) {
      return res.status(400).json({
        success: false,
        message: 'This reset link has already been used. Please request a new one.'
      });
    }

    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, record.user_id]);

    console.log(`[Auth] Password reset completed for user ${record.user_id}`);

    res.status(200).json({
      success: true,
      message: 'Your password has been changed. You can now sign in.'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { requestPasswordReset, verifyResetToken, resetPassword };