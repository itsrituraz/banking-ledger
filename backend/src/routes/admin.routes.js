const express = require("express");
const { authMiddleware, adminMiddleware } = require("../middleware/auth.middleware");
const { adminLimiter } = require("../middleware/rateLimiter.middleware");
const adminController = require("../controllers/admin.controller");

const router = express.Router();

// Apply authMiddleware + adminMiddleware + adminLimiter across all admin routes
router.use(authMiddleware, adminMiddleware, adminLimiter);

/**
 * GET /api/admin/health
 * Protected admin health check endpoint
 */
router.get("/health", (req, res) => {
  return res.status(200).json({
    message: "Admin access granted"
  });
});

/**
 * GET /api/admin/dashboard/stats
 * Aggregate dashboard statistics
 */
router.get("/dashboard/stats", adminController.getDashboardStats);

/**
 * GET /api/admin/transactions/flagged
 * Note: Must be declared before /transactions/:id
 */
router.get("/transactions/flagged", adminController.getFlaggedTransactions);

/**
 * GET /api/admin/transactions
 * Paginated and filtered transaction list
 */
router.get("/transactions", adminController.getTransactions);

/**
 * GET /api/admin/transactions/:id
 * Individual transaction details with populated relations & ledger
 */
router.get("/transactions/:id", adminController.getTransactionById);

/**
 * GET /api/admin/users
 * Paginated user monitoring list with optional search
 */
router.get("/users", adminController.getUsers);

/**
 * GET /api/admin/audit-logs
 * Paginated and filtered immutable audit log list
 */
router.get("/audit-logs", adminController.getAuditLogs);

/**
 * GET /api/admin/audit-logs/:id
 * Individual audit log entry details
 */
router.get("/audit-logs/:id", adminController.getAuditLogById);

module.exports = router;
