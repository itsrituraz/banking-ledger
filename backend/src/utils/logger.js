/**
 * Structured Production Logger
 * Lightweight, zero-dependency, JSON-first operational logging.
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const CURRENT_LEVEL = (process.env.LOG_LEVEL || "INFO").toUpperCase();
const CURRENT_LEVEL_NUM = LOG_LEVELS[CURRENT_LEVEL] !== undefined ? LOG_LEVELS[CURRENT_LEVEL] : LOG_LEVELS.INFO;

// Blacklist of sensitive key patterns (case-insensitive substring matches)
const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /hash/i,
  /token/i,
  /jwt/i,
  /secret/i,
  /cookie/i,
  /authorization/i,
  /creditCard/i,
  /cvv/i,
  /pin/i,
  /apikey/i,
  /database_url/i,
  /mongo_uri/i
];

/**
 * Deep recursive sanitizer for log objects
 * Redacts any keys matching sensitive patterns.
 */
function sanitizeLogData(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizeLogData);
  }

  if (obj instanceof Date || obj instanceof RegExp) {
    return obj;
  }

  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    const isSensitive = SENSITIVE_KEY_PATTERNS.some(p => p.test(key));
    if (isSensitive) {
      clean[key] = "[REDACTED]";
    } else if (value && typeof value === "object") {
      clean[key] = sanitizeLogData(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Outputs a structured log entry
 */
function writeLog(level, event, data = {}) {
  if (LOG_LEVELS[level] < CURRENT_LEVEL_NUM) {
    return;
  }

  const sanitized = sanitizeLogData(data);

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...sanitized
  };

  const output = JSON.stringify(entry);

  if (level === "ERROR") {
    process.stderr.write(output + "\n");
  } else {
    process.stdout.write(output + "\n");
  }

  return entry;
}

const logger = {
  debug: (event, data) => writeLog("DEBUG", event, data),
  info: (event, data) => writeLog("INFO", event, data),
  warn: (event, data) => writeLog("WARN", event, data),
  error: (event, data) => writeLog("ERROR", event, data),
  sanitizeLogData,
  writeLog
};

module.exports = logger;
