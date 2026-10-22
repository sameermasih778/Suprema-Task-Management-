// Centralized Error Handling Middleware
const errorHandler = (err, req, res, next) => {
  console.error(`❌ [${new Date().toISOString()}] Error ${req.method} ${req.originalUrl}:`, err.message);

  if (process.env.NODE_ENV === 'development') {
    console.error(err.stack);
  }

  // Handle specific database errors.
  // PostgreSQL error codes: 23505 = unique_violation, 23503 = foreign_key_violation.
  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      message: 'A record with this information already exists.',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }

  if (err.code === '23503') {
    return res.status(400).json({
      success: false,
      message: 'Referenced foreign key entity does not exist.',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }

  const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : (err.statusCode || 500);

  // An unexpected server fault (5xx) is the app's fault, not the caller's, so
  // its raw message - which can contain SQL fragments, hostnames or file paths -
  // must never reach the client. The full error is already logged above for the
  // developer to read. 4xx messages are authored deliberately by our own
  // controllers and are safe to pass through.
  const isServerFault = statusCode >= 500;

  res.status(statusCode).json({
    success: false,
    message: isServerFault ? 'Something went wrong on our end. Please try again.' : err.message || 'Request could not be completed.',
    errors: err.errors || null,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};

module.exports = errorHandler;
