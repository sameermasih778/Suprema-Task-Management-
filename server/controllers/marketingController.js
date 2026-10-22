const pool = require('../config/db');
const crypto = require('crypto');
const { withLineBreaks } = require('../utils/text');

/**
 * Public marketing endpoints.
 *
 * These are the only endpoints in the app that do NOT require a session - the
 * Contact form and Waitlist are how prospective customers reach you before they
 * have an account. That makes them the most attractive spam target in the
 * project, so every write is validated, rate limited at the route layer, and
 * stored without ever being rendered back as HTML.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_NAME = 100;
const MAX_EMAIL = 150;
const MAX_SUBJECT = 200;
const MAX_MESSAGE = 5000;

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * POST /api/v1/contact
 * Public contact form submission.
 */
const submitContactMessage = async (req, res, next) => {
  try {
    const name = clean(req.body?.name);
    const email = clean(req.body?.email).toLowerCase();
    const subject = clean(req.body?.subject) || 'Website Inquiry';
    const message = clean(req.body?.message);

    const errors = {};
    if (!name) errors.name = 'Name is required';
    else if (name.length > MAX_NAME) errors.name = `Name must be under ${MAX_NAME} characters`;

    if (!email) errors.email = 'Email is required';
    else if (email.length > MAX_EMAIL || !EMAIL_RE.test(email)) errors.email = 'Enter a valid email address';

    if (!message) errors.message = 'Message is required';
    else if (message.length > MAX_MESSAGE) errors.message = `Message must be under ${MAX_MESSAGE} characters`;

    if (subject.length > MAX_SUBJECT) errors.subject = `Subject must be under ${MAX_SUBJECT} characters`;

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Please fix the highlighted fields.',
        errors
      });
    }

    await pool.query(
      'INSERT INTO contact_messages (name, email, subject, message) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, email, subject, message]
    );

    res.status(201).json({
      success: true,
      message: 'Thanks for reaching out. We will get back to you shortly.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/waitlist
 * Join the early-access waitlist.
 *
 * A duplicate email is not an error: the person gets their EXISTING queue
 * position back, so a double-click or a forgotten confirmation still tells them
 * where they stand instead of looking like a failure.
 */
const joinWaitlist = async (req, res, next) => {
  try {
    const email = clean(req.body?.email).toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required.',
        errors: { email: 'Email is required' }
      });
    }
    if (email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Enter a valid email address.',
        errors: { email: 'Enter a valid email address' }
      });
    }

    const [existing] = await pool.query(
      'SELECT id, queue_position FROM waitlist_leads WHERE email = $1',
      [email]
    );
    if (existing.length > 0) {
      const position = existing[0].queue_position ?? 0;
      return res.status(200).json({
        success: true,
        alreadyRegistered: true,
        position,
        message: `You are already on the waitlist - position #${position}.`
      });
    }

    // Next position = current maximum + 1. queue_position is UNIQUE, so a race
    // between two simultaneous signups fails loudly here instead of silently
    // handing two people the same number.
    const [[next]] = await pool.query(
      'SELECT COALESCE(MAX(queue_position), 0) + 1 AS next_position FROM waitlist_leads'
    );
    const position = next.next_position;
    const referralCode = `SUP-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

    try {
      await pool.query(
        'INSERT INTO waitlist_leads (email, queue_position, referral_code) VALUES ($1, $2, $3) RETURNING id',
        [email, position, referralCode]
      );
    } catch (insertErr) {
      // Lost a race, or the email was inserted a moment ago: report the real
      // position rather than a 500.
      // 23505 is PostgreSQL's unique_violation.
      if (insertErr.code === '23505') {
        const [[again]] = await pool.query(
          'SELECT queue_position FROM waitlist_leads WHERE email = $1',
          [email]
        );
        return res.status(200).json({
          success: true,
          alreadyRegistered: true,
          position: again?.queue_position ?? position,
          message: `You are already on the waitlist - position #${again?.queue_position ?? position}.`
        });
      }
      throw insertErr;
    }

    res.status(201).json({
      success: true,
      alreadyRegistered: false,
      position,
      referralCode,
      message: `You are on the list! You are #${position} in line.`
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/changelogs
 * Public release notes, newest first.
 */
const getChangelogs = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT tag_id, date, release_date, badge, badge_color, title, description,
              sub_item_title, sub_item_description, tag, banner_title, bullets, note
       FROM changelogs
       ORDER BY release_date DESC, id DESC`
    );

    const changelogs = rows.map((row) => ({
      id: row.tag_id,
      slug: row.tag_id,
      tagId: row.tag_id,
      date: row.date,
      releaseDate: row.release_date,
      badge: row.badge,
      badgeColor: row.badge_color,
      // Heading fields only: rows written before the write-path fix store an
      // escaped '\n' there (see utils/text.js). Normalising on read means the
      // existing entries render with a real line break, without rewriting the
      // table. Free text keeps any genuine backslash it contains.
      title: withLineBreaks(row.title),
      subItemTitle: withLineBreaks(row.sub_item_title),
      bannerTitle: withLineBreaks(row.banner_title),
      description: row.description,
      tag: row.tag,
      subItemDescription: row.sub_item_description,
      bullets: parseJsonArray(row.bullets),
      note: row.note
    }));

    res.status(200).json({ success: true, count: changelogs.length, changelogs });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/pricing
 * Subscription tiers in display order.
 */
const getPricingPlans = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT plan_id, name, price_monthly, price_yearly, period, subtext,
              popular, popular_badge, has_toggle, btn_variant, btn_text, features
       FROM pricing_plans
       ORDER BY sort_order ASC, id ASC`
    );

    const plans = rows.map((row) => ({
      id: row.plan_id,
      slug: row.plan_id,
      name: row.name,
      // Kept as the display string the page already renders ('?'), plus the
      // numeric value so the yearly toggle can actually change the price
      // instead of only animating a switch.
      price: row.price_monthly,
      priceMonthly: numericPrice(row.price_monthly),
      priceYearly: numericPrice(row.price_yearly),
      period: row.period,
      subtext: row.subtext,
      popular: !!row.popular,
      popularBadge: row.popular_badge,
      hasToggle: !!row.has_toggle,
      btnVariant: row.btn_variant,
      btnText: row.btn_text,
      features: parseJsonArray(row.features)
    }));

    res.status(200).json({ success: true, count: plans.length, plans });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  submitContactMessage,
  joinWaitlist,
  getChangelogs,
  getPricingPlans
};

/* ───────────────────────────── helpers ───────────────────────────── */

/** MySQL 8 hands back JSON columns parsed; MariaDB hands back a string. */
function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** '?' -> 12 */
function numericPrice(value) {
  if (value === null || value === undefined) return null;
  const n = Number(String(value).replace(/[^0-9.]/g, ''));
  return Number.isNaN(n) ? null : n;
}
