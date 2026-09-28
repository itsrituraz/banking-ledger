const logger = require("../utils/logger");

const SLOW_REQUEST_THRESHOLD_MS = parseInt(process.env.SLOW_REQUEST_THRESHOLD_MS || "1000", 10);

/**
 * Middleware that records HTTP request start, response finish, duration, and slow requests.
 */
function requestLoggerMiddleware(req, res, next) {
  const startTime = Date.now();
  const requestId = req.requestId || "UNKNOWN";
  const path = req.originalUrl || req.url;
  const method = req.method;

  // 1. Log incoming request (safe metadata only - no bodies, auth headers, or cookies)
  logger.info("HTTP_REQUEST", {
    requestId,
    method,
    path
  });

  // 2. Intercept response completion
  res.on("finish", () => {
    const durationMs = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Log response
    logger.info("HTTP_RESPONSE", {
      requestId,
      method,
      path,
      statusCode,
      durationMs
    });

    // Detect slow requests above configurable threshold
    if (durationMs >= SLOW_REQUEST_THRESHOLD_MS) {
      logger.warn("SLOW_REQUEST", {
        requestId,
        method,
        path,
        statusCode,
        durationMs,
        thresholdMs: SLOW_REQUEST_THRESHOLD_MS
      });
    }
  });

  next();
}

module.exports = requestLoggerMiddleware;
