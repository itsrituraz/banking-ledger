/**
 * Production Environment Validation
 * Validates critical environment configuration before starting the server.
 * Ensures the application fails fast if required secrets or configurations are missing.
 * STRICT SECURITY RULE: Never log or print the actual values of secrets.
 */

const logger = require("../utils/logger");

function validateEnv() {
  const isProduction = process.env.NODE_ENV === "production";
  const errors = [];
  const warnings = [];

  // 1. Critical Database Configuration
  if (!process.env.MONGO_URI) {
    errors.push("MONGO_URI is not configured in environment variables.");
  }

  // 2. Critical Authentication Secret
  if (!process.env.JWT_SECRET) {
    errors.push("JWT_SECRET is not configured in environment variables.");
  } else if (isProduction && process.env.JWT_SECRET.length < 32) {
    errors.push("JWT_SECRET must be at least 32 characters in production for cryptographic safety.");
  }

  // 3. Frontend Origin Configuration (CORS & Cookie alignment)
  if (isProduction && !process.env.FRONTEND_URL) {
    warnings.push("FRONTEND_URL is not set in production. CORS will fallback to localhost:5173.");
  }

  // 4. Reverse Proxy Warning
  if (isProduction && !process.env.TRUST_PROXY) {
    warnings.push("TRUST_PROXY is not explicitly configured. If deployed behind a reverse proxy (e.g. Render, Cloudflare, ALB), rate limiting and audit logs may record proxy IPs.");
  }

  // Output warnings
  warnings.forEach(w => {
    logger.warn("CONFIG_WARNING", { message: w });
  });

  // Handle fatal errors
  if (errors.length > 0) {
    errors.forEach(e => {
      logger.error("CONFIG_ERROR", { message: e });
      console.error(`[FATAL CONFIG ERROR] ${e}`);
    });
    console.error("[FATAL] Production configuration validation failed. Server terminated to prevent insecure startup.");
    process.exit(1);
  }

  return { isValid: true };
}

module.exports = validateEnv;
