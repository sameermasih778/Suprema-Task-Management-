const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const { apiLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const apiRouter = require('./routes');

const app = express();

// Security Middlewares
app.use(helmet());

/**
 * CORS configuration.
 *
 * `origin` is a resolver rather than a fixed string because Vite does NOT
 * always run on 5173 - if that port is still held by a previous dev process it
 * silently falls back to 5174, 5175, ... A hardcoded CLIENT_ORIGIN then
 * rejects every API call: the server still processes the request and logs
 * "200", but the browser discards the response because the
 * Access-Control-Allow-Origin header does not match the page's origin. That
 * surfaces in the UI as an authentication failure with nothing wrong with the
 * credentials, which is very hard to debug.
 *
 * CLIENT_ORIGIN accepts a comma-separated list for multiple real origins. In
 * development we additionally allow any loopback host on any port, which is
 * safe (nothing outside this machine can present such an Origin) and removes
 * the port-mismatch trap entirely. Production stays restricted to the
 * explicitly configured origins - it never gets the loopback wildcard.
 */
const configuredOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const isDevelopment = process.env.NODE_ENV !== 'production';
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

app.use(cors({
  origin: (origin, callback) => {
    // Non-browser clients (curl, Postman, server-to-server) send no Origin.
    if (!origin) return callback(null, true);

    if (configuredOrigins.includes(origin)) return callback(null, true);

    if (isDevelopment && LOOPBACK_ORIGIN.test(origin)) return callback(null, true);

    return callback(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Global Rate Limiting
app.use('/api/', apiLimiter);

// Static Uploads Serving
//
// The frontend and the API are served from DIFFERENT origins by design
// (localhost:5173 vs localhost:5000 in dev, and two separate *.vercel.app
// hosts in production). Helmet's default `Cross-Origin-Resource-Policy:
// same-origin` therefore makes browsers refuse to render uploaded avatars and
// attachments at all - the file downloads with HTTP 200 but paints as a 0x0
// broken image.
//
// CORP only controls whether another origin may EMBED a resource; it is not an
// access control. Relaxing it for this static route changes nothing about who
// can read data through the API, which stays protected by JWT auth and the
// CLIENT_ORIGIN allowlist.
app.use(
  '/uploads',
  (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  },
  express.static(path.join(__dirname, 'uploads'))
);

// Parsing Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging Middleware
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Health Check at root level
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', server: 'Suprema Backend API', timestamp: new Date() });
});

// API Routes Mount
app.use('/api/v1', apiRouter);

// 404 Unhandled Route Handler
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Resource endpoint '${req.originalUrl}' not found on Suprema server.`
  });
});

// Centralized Error Handling Middleware
app.use(errorHandler);

// Warm the SMTP connection in the background. Gmail's TLS handshake can take
// 15-23s from some networks; paying it at boot means the first password reset
// or OTP email is fast. Fire and forget - it never blocks startup.
if (process.env.NODE_ENV !== 'test') {
  require('./config/mailer').warmup();
}

const PORT = parseInt(process.env.PORT || '5000', 10);
// On Vercel the exported app IS the serverless function (VERCEL=1 is set by
// the platform) - binding a local port there is unnecessary.
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 Suprema Express Backend Server running on port ${PORT}`);
    console.log(`📡 Environment: [${process.env.NODE_ENV || 'development'}]`);
    console.log(`🌐 Allowed Client Origin: ${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}`);
  });
}

/**
 * Close the database pool on shutdown.
 *
 * This matters more than it looks with a pooled database. nodemon restarts the
 * server on every file change during development, and a process that exits
 * without closing its pool leaves the connection pooler holding those server
 * connections until it reaps them. After a few dozen restarts the pooler is
 * saturated, new connections queue behind the stale ones, and every query
 * times out. Closing the pool makes a restart release its connections
 * immediately.
 */
let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received - closing the database pool...`);
  try {
    const pool = require('./config/db');
    await pool.end();
    console.log('✅ Database pool closed');
  } catch (err) {
    console.warn('⚠️  Could not close the database pool:', err.message);
  }
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
