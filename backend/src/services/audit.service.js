const auditLogModel = require("../models/auditLog.model");

// Blacklist of sensitive key substrings that must NEVER be written to audit logs
const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /hash/i,
  /token/i,
  /jwt/i,
  /secret/i,
  /cookie/i,
  /authorization/i,
  /creditCard/i,
  /cvv/i
];

/**
 * Deeply sanitizes metadata to prevent any accidental leakage of credentials or secrets.
 * @param {any} obj 
 * @returns {any} Sanitized object
 */
function sanitizeMetadata(obj) {
  if (obj === null || obj === undefined) return {};
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map(sanitizeMetadata);
  }

  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
    if (isSensitive) {
      continue; // Completely strip sensitive field
    }

    if (value && typeof value === "object" && !(value instanceof Date)) {
      clean[key] = sanitizeMetadata(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Append-only audit logger
 * 
 * @param {Object} params
 * @param {ObjectId|string} [params.actorUser] - User who triggered the action
 * @param {string} params.action - Machine-readable action code
 * @param {string} params.resourceType - TRANSACTION, USER, ACCOUNT, AUTH, ADMIN, RISK, SYSTEM
 * @param {string} [params.resourceId] - ID of affected resource
 * @param {ObjectId|string} [params.transactionId] - Optional transaction reference
 * @param {ObjectId|string} [params.targetUserId] - Optional target user reference
 * @param {string} [params.requestId] - Request correlation ID
 * @param {string} [params.ipAddress] - Client IP address
 * @param {string} [params.userAgent] - Client User Agent string
 * @param {Object} [params.metadata] - Safe contextual metadata
 * @param {ClientSession} [params.session] - MongoDB ACID session (for financial atomicity)
 * 
 * @returns {Promise<Document>} The created immutable AuditLog document
 */
async function logAuditEvent({
  actorUser = null,
  action,
  resourceType,
  resourceId = null,
  transactionId = null,
  targetUserId = null,
  requestId = null,
  ipAddress = null,
  userAgent = null,
  metadata = {},
  session = null
}) {
  if (!action || typeof action !== "string") {
    throw new Error("Audit action must be a non-empty string");
  }

  if (!resourceType || typeof resourceType !== "string") {
    throw new Error("Audit resourceType must be a non-empty string");
  }

  const cleanMetadata = sanitizeMetadata(metadata);

  const payload = {
    actorUser: actorUser || null,
    action: action.trim(),
    resourceType: resourceType.trim().toUpperCase(),
    resourceId: resourceId ? String(resourceId) : null,
    transactionId: transactionId || null,
    targetUserId: targetUserId || null,
    requestId: requestId ? String(requestId) : null,
    ipAddress: ipAddress ? String(ipAddress) : null,
    userAgent: userAgent ? String(userAgent) : null,
    metadata: cleanMetadata,
    createdAt: new Date()
  };

  const options = session ? { session } : {};

  // Use array syntax with .create to properly accept mongoose session options
  const createdLogs = await auditLogModel.create([payload], options);
  return createdLogs[0];
}

module.exports = {
  logAuditEvent,
  sanitizeMetadata
};
