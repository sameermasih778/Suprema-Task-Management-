/**
 * Set a user's password directly in the database.
 *
 * Useful when a seeded/demo account needs a real password, or when nobody can
 * log in to use the admin panel's reset button. Works against whichever
 * database server/.env points at (Aiven in production, local MySQL in dev).
 *
 * Usage:
 *   node scripts/set-password.js <email> <new-password>
 *   NEW_PASSWORD='...' node scripts/set-password.js <email>
 *   node scripts/set-password.js --generate <email>     # random strong password
 *
 * The password is hashed with bcrypt (cost 12) exactly like the auth flow, so
 * it is never stored in plain text. Minimum length: 8 characters.
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../config/db');

const MIN_LENGTH = 8;

function strongPassword() {
  // Guaranteed to satisfy the minimum length and contain mixed character
  // classes, so it passes any reasonable password policy.
  return `Sup${crypto.randomBytes(6).toString('base64url')}!${Math.floor(Math.random() * 90 + 10)}`;
}

async function main() {
  const args = process.argv.slice(2);
  const useGenerated = args[0] === '--generate';
  const email = (useGenerated ? args[1] : args[0])?.trim();
  const newPassword = useGenerated ? strongPassword() : (args[1] || process.env.NEW_PASSWORD || '');

  if (!email) {
    console.error('Usage: node scripts/set-password.js [--generate] <email> [new-password]');
    process.exit(1);
  }

  if (newPassword.length < MIN_LENGTH) {
    console.error(`Password must be at least ${MIN_LENGTH} characters.`);
    process.exit(1);
  }

  const [users] = await pool.query('SELECT id, name, email FROM users WHERE email = $1', [email]);
  if (users.length === 0) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  const user = users[0];
  const password_hash = await bcrypt.hash(newPassword, 12);
  const [result] = await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [password_hash, user.id]);

  // Guard against a silent no-op: a matched-looking UPDATE that changed zero
  // rows would leave the old password in place and report success.
  if (result.affectedRows !== 1) {
    console.error(
      `ERROR: expected to update 1 row for id ${user.id}, but ${result.affectedRows} changed. Password NOT changed.`
    );
    process.exit(1);
  }

  // Read it back and prove the new password actually verifies against what is
  // now stored - the only check that matters.
  const [check] = await pool.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
  const verified = await bcrypt.compare(newPassword, check[0].password_hash);
  if (!verified) {
    console.error('ERROR: stored hash does not verify against the new password. Aborting.');
    process.exit(1);
  }

  console.log(`Password updated for ${user.name} <${user.email}> (id ${user.id}) - verified.`);
  if (useGenerated) console.log(`Generated password: ${newPassword}`);
  else console.log('Password: (the value you passed)');

  process.exit(0);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});