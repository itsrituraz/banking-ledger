const crypto = require("crypto");

/**
 * Lightweight request correlation ID middleware
 * Attaches a unique request ID (e.g. REQ-xxxxxxxx) to req.requestId and X-Request-Id header.
 */
function requestIdMiddleware(req, res, next) {
  const incomingId = req.headers["x-request-id"];
  const requestId = (incomingId && typeof incomingId === "string" && incomingId.trim().length > 0)
    ? incomingId.trim()
    : `REQ-${crypto.randomBytes(6).toString("hex")}`;

  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}

module.exports = requestIdMiddleware;
