const { Router } = require("express");
const { authMiddleware, authSystemUserMiddleware } = require("../middleware/auth.middleware");
const { transactionLimiter } = require("../middleware/rateLimiter.middleware");
const transactionController = require("../controllers/transaction.controller");

const transactionRoutes = Router();

transactionRoutes.get("/", authMiddleware, transactionController.getTransactions);

/**
 * - POST /api/transactions/
 * Create a new transaction (protected by auth + rate limiting)
 */
transactionRoutes.post("/", authMiddleware, transactionLimiter, transactionController.createTransaction);

/**
 * - POST /api/transactions/system/initial-funds
 * create initial funds transaction from system user
 */
transactionRoutes.post("/system/initial-funds", authSystemUserMiddleware, transactionController.createInitialFundsTransaction);

module.exports = transactionRoutes;