const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

/**
 * Standardized 429 error response handler
 */
function createRateLimitHandler(customMessage) {
  return (req, res, next, options) => {
    return res.status(options.statusCode).json({
      message: customMessage || "Too many requests. Please try again later."
    });
  };
}

/**
 * Key generator prioritizing authenticated user ID over IP
 */
function userOrIpKeyGenerator(req) {
  if (req.user && req.user._id) {
    return req.user._id.toString();
  }

  return (
    req.headers["x-test-client-ip"] ||
    ipKeyGenerator(req)
  );
}

/**
 * 1. Auth Rate Limiter
 */
const authLimiter = rateLimit({
  windowMs: parseInt(
    process.env.RATE_LIMIT_AUTH_WINDOW_MS || "900000",
    10
  ),
  max: parseInt(
    process.env.RATE_LIMIT_AUTH_MAX || "20",
    10
  ),
  standardHeaders: "draft-7",
  legacyHeaders: false,

  keyGenerator: (req) => {
    return (
      req.headers["x-test-client-ip"] ||
      ipKeyGenerator(req)
    );
  },

  skip: (req) => req.method === "OPTIONS",

  handler: createRateLimitHandler(
    "Too many authentication attempts. Please try again later."
  )
});

/**
 * 2. Transaction Rate Limiter
 */
const transactionLimiter = rateLimit({
  windowMs: parseInt(
    process.env.RATE_LIMIT_TX_WINDOW_MS || "60000",
    10
  ),
  max: parseInt(
    process.env.RATE_LIMIT_TX_MAX || "60",
    10
  ),
  standardHeaders: "draft-7",
  legacyHeaders: false,

  keyGenerator: userOrIpKeyGenerator,

  skip: (req) => req.method === "OPTIONS",

  handler: createRateLimitHandler(
    "Too many transaction requests. Please try again later."
  )
});

/**
 * 3. Admin Rate Limiter
 */
const adminLimiter = rateLimit({
  windowMs: parseInt(
    process.env.RATE_LIMIT_ADMIN_WINDOW_MS || "60000",
    10
  ),
  max: parseInt(
    process.env.RATE_LIMIT_ADMIN_MAX || "120",
    10
  ),
  standardHeaders: "draft-7",
  legacyHeaders: false,

  keyGenerator: userOrIpKeyGenerator,

  skip: (req) => req.method === "OPTIONS",

  handler: createRateLimitHandler(
    "Too many admin requests. Please try again later."
  )
});

/**
 * 4. Global API Rate Limiter
 */
const apiLimiter = rateLimit({
  windowMs: parseInt(
    process.env.RATE_LIMIT_GLOBAL_WINDOW_MS || "900000",
    10
  ),
  max: parseInt(
    process.env.RATE_LIMIT_GLOBAL_MAX || "1000",
    10
  ),
  standardHeaders: "draft-7",
  legacyHeaders: false,

  skip: (req) => req.method === "OPTIONS",

  handler: createRateLimitHandler(
    "Too many requests. Please try again later."
  )
});

module.exports = {
  authLimiter,
  transactionLimiter,
  adminLimiter,
  apiLimiter
};