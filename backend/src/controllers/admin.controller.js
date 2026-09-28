const mongoose = require("mongoose");
const userModel = require("../models/user.model");
const accountModel = require("../models/account.model");
const transactionModel = require("../models/transaction.model");
const ledgerModel = require("../models/ledger.model");
const auditLogModel = require("../models/auditLog.model");
const auditService = require("../services/audit.service");
const logger = require("../utils/logger");

/**
 * Helper to validate and parse pagination parameters
 */
function parsePagination(query) {
  const page = parseInt(query.page || "1", 10);
  const limit = parseInt(query.limit || "20", 10);

  if (isNaN(page) || page < 1) {
    return { error: "Invalid page parameter. Must be an integer >= 1" };
  }
  if (isNaN(limit) || limit < 1 || limit > 100) {
    return { error: "Invalid limit parameter. Must be an integer between 1 and 100" };
  }

  return { page, limit, skip: (page - 1) * limit };
}

/**
 * GET /api/admin/dashboard/stats
 * Aggregate dashboard statistics
 */
async function getDashboardStats(req, res) {
  try {
    const [totalUsers, txStats] = await Promise.all([
      userModel.countDocuments(),
      transactionModel.aggregate([
        {
          $facet: {
            total: [{ $count: "count" }],
            completed: [{ $match: { status: "COMPLETED" } }, { $count: "count" }],
            failed: [{ $match: { status: "FAILED" } }, { $count: "count" }],
            flagged: [{ $match: { riskStatus: "FLAGGED" } }, { $count: "count" }],
            manualReview: [{ $match: { riskStatus: "MANUAL_REVIEW" } }, { $count: "count" }],
            blocked: [{ $match: { riskStatus: "BLOCKED" } }, { $count: "count" }],
            volume: [
              { $match: { status: "COMPLETED" } },
              { $group: { _id: null, totalVolume: { $sum: "$amount" } } }
            ]
          }
        }
      ])
    ]);

    const facet = txStats[0] || {};
    const totalTransactions = facet.total?.[0]?.count || 0;
    const completedTransactions = facet.completed?.[0]?.count || 0;
    const failedTransactions = facet.failed?.[0]?.count || 0;
    const flaggedTransactions = facet.flagged?.[0]?.count || 0;
    const manualReviewTransactions = facet.manualReview?.[0]?.count || 0;
    const blockedTransactions = facet.blocked?.[0]?.count || 0;
    const totalTransactionVolume = facet.volume?.[0]?.totalVolume || 0;

    logger.info("ADMIN_RESOURCE_VIEWED", {
      requestId: req.requestId,
      userId: req.user?._id?.toString(),
      role: req.user?.role,
      resource: "DASHBOARD_STATS",
      statusCode: 200
    });

    return res.status(200).json({
      totalUsers,
      totalTransactions,
      completedTransactions,
      failedTransactions,
      flaggedTransactions,
      manualReviewTransactions,
      blockedTransactions,
      totalTransactionVolume
    });
  } catch (error) {
    console.error("getDashboardStats error:", error);
    return res.status(500).json({ message: "Failed to fetch dashboard statistics" });
  }
}

/**
 * GET /api/admin/transactions
 * Paginated and filtered transaction monitoring list
 */
async function getTransactions(req, res) {
  try {
    const pagination = parsePagination(req.query);
    if (pagination.error) {
      return res.status(400).json({ message: pagination.error });
    }
    const { page, limit, skip } = pagination;

    const filter = {};

    // Filter: status
    if (req.query.status) {
      const allowedStatuses = ["PENDING", "COMPLETED", "FAILED", "REVERSED"];
      if (!allowedStatuses.includes(req.query.status)) {
        return res.status(400).json({ message: `Invalid status filter. Allowed: ${allowedStatuses.join(", ")}` });
      }
      filter.status = req.query.status;
    }

    // Filter: riskStatus
    if (req.query.riskStatus) {
      const allowedRisk = ["APPROVED", "FLAGGED", "MANUAL_REVIEW", "BLOCKED"];
      if (!allowedRisk.includes(req.query.riskStatus)) {
        return res.status(400).json({ message: `Invalid riskStatus filter. Allowed: ${allowedRisk.join(", ")}` });
      }
      filter.riskStatus = req.query.riskStatus;
    }

    // Filter: minAmount / maxAmount
    if (req.query.minAmount !== undefined) {
      const min = Number(req.query.minAmount);
      if (isNaN(min) || min < 0) {
        return res.status(400).json({ message: "minAmount must be a non-negative number" });
      }
      filter.amount = filter.amount || {};
      filter.amount.$gte = min;
    }
    if (req.query.maxAmount !== undefined) {
      const max = Number(req.query.maxAmount);
      if (isNaN(max) || max < 0) {
        return res.status(400).json({ message: "maxAmount must be a non-negative number" });
      }
      filter.amount = filter.amount || {};
      filter.amount.$lte = max;
    }

    // Filter: fromAccount / toAccount
    if (req.query.fromAccount) {
      if (!mongoose.Types.ObjectId.isValid(req.query.fromAccount)) {
        return res.status(400).json({ message: "Invalid fromAccount ObjectId" });
      }
      filter.fromAccount = req.query.fromAccount;
    }
    if (req.query.toAccount) {
      if (!mongoose.Types.ObjectId.isValid(req.query.toAccount)) {
        return res.status(400).json({ message: "Invalid toAccount ObjectId" });
      }
      filter.toAccount = req.query.toAccount;
    }

    // Filter: dateFrom / dateTo
    if (req.query.dateFrom) {
      const fromDate = new Date(req.query.dateFrom);
      if (isNaN(fromDate.getTime())) {
        return res.status(400).json({ message: "Invalid dateFrom format" });
      }
      filter.createdAt = filter.createdAt || {};
      filter.createdAt.$gte = fromDate;
    }
    if (req.query.dateTo) {
      const toDate = new Date(req.query.dateTo);
      if (isNaN(toDate.getTime())) {
        return res.status(400).json({ message: "Invalid dateTo format" });
      }
      filter.createdAt = filter.createdAt || {};
      filter.createdAt.$lte = toDate;
    }

    const [total, transactions] = await Promise.all([
      transactionModel.countDocuments(filter),
      transactionModel
        .find(filter)
        .populate({
          path: "fromAccount",
          select: "_id status currency user",
          populate: { path: "user", select: "name email" }
        })
        .populate({
          path: "toAccount",
          select: "_id status currency user",
          populate: { path: "user", select: "name email" }
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
    ]);

    const formatted = transactions.map(tx => ({
      id: tx._id.toString(),
      _id: tx._id.toString(),
      fromAccount: tx.fromAccount,
      toAccount: tx.toAccount,
      amount: tx.amount,
      status: tx.status,
      idempotencyKey: tx.idempotencyKey,
      riskScore: tx.riskScore,
      riskStatus: tx.riskStatus,
      riskReasons: tx.riskReasons,
      isFirstTimeBeneficiary: tx.isFirstTimeBeneficiary,
      clientIp: tx.clientIp,
      userAgent: tx.userAgent,
      createdAt: tx.createdAt,
      updatedAt: tx.updatedAt
    }));

    logger.info("ADMIN_RESOURCE_VIEWED", {
      requestId: req.requestId,
      userId: req.user?._id?.toString(),
      role: req.user?.role,
      resource: "TRANSACTIONS_LIST",
      count: formatted.length,
      statusCode: 200
    });

    return res.status(200).json({
      transactions: formatted,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      }
    });
  } catch (error) {
    console.error("getTransactions error:", error);
    return res.status(500).json({ message: "Failed to fetch transactions" });
  }
}

/**
 * GET /api/admin/transactions/flagged
 * Retrieve elevated risk transactions (FLAGGED, MANUAL_REVIEW, BLOCKED)
 */
async function getFlaggedTransactions(req, res) {
  try {
    const pagination = parsePagination(req.query);
    if (pagination.error) {
      return res.status(400).json({ message: pagination.error });
    }
    const { page, limit, skip } = pagination;

    const filter = {
      riskStatus: { $in: ["FLAGGED", "MANUAL_REVIEW", "BLOCKED"] }
    };

    const [total, transactions] = await Promise.all([
      transactionModel.countDocuments(filter),
      transactionModel
        .find(filter)
        .populate({
          path: "fromAccount",
          select: "_id status currency user",
          populate: { path: "user", select: "name email" }
        })
        .populate({
          path: "toAccount",
          select: "_id status currency user",
          populate: { path: "user", select: "name email" }
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
    ]);

    const formatted = transactions.map(tx => ({
      id: tx._id.toString(),
      _id: tx._id.toString(),
      amount: tx.amount,
      senderAccount: tx.fromAccount,
      receiverAccount: tx.toAccount,
      transactionStatus: tx.status,
      riskStatus: tx.riskStatus,
      riskScore: tx.riskScore,
      riskReasons: tx.riskReasons,
      isFirstTimeBeneficiary: tx.isFirstTimeBeneficiary,
      clientIp: tx.clientIp,
      userAgent: tx.userAgent,
      createdAt: tx.createdAt
    }));

    // Audit log: Admin viewed elevated risk data
    try {
      await auditService.logAuditEvent({
        actorUser: req.user?._id,
        action: "ADMIN_VIEWED_RISK_DATA",
        resourceType: "RISK",
        requestId: req.requestId,
        ipAddress: req.ip || req.connection?.remoteAddress,
        userAgent: req.headers["user-agent"],
        metadata: { filter: "FLAGGED,MANUAL_REVIEW,BLOCKED", resultCount: transactions.length }
      });
    } catch (auditErr) {
      console.error("Audit log error (ADMIN_VIEWED_RISK_DATA):", auditErr.message);
    }

    logger.info("ADMIN_RESOURCE_VIEWED", {
      requestId: req.requestId,
      userId: req.user?._id?.toString(),
      role: req.user?.role,
      resource: "FLAGGED_TRANSACTIONS",
      count: formatted.length,
      statusCode: 200
    });

    return res.status(200).json({
      transactions: formatted,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      }
    });
  } catch (error) {
    console.error("getFlaggedTransactions error:", error);
    return res.status(500).json({ message: "Failed to fetch flagged transactions" });
  }
}

/**
 * GET /api/admin/transactions/:id
 * Retrieve comprehensive details for a single transaction including ledger entries
 */
async function getTransactionById(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid transaction ID format" });
    }

    const tx = await transactionModel
      .findById(id)
      .populate({
        path: "fromAccount",
        select: "_id status currency sequence user createdAt",
        populate: { path: "user", select: "name email role createdAt" }
      })
      .populate({
        path: "toAccount",
        select: "_id status currency sequence user createdAt",
        populate: { path: "user", select: "name email role createdAt" }
      });

    if (!tx) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    // Retrieve ledger entries associated with this transaction
    const ledgerEntries = await ledgerModel
      .find({ transaction: tx._id })
      .select("_id account amount type createdAt")
      .sort({ type: 1 });

    // Audit log: Admin viewed individual transaction
    try {
      await auditService.logAuditEvent({
        actorUser: req.user?._id,
        action: "ADMIN_VIEWED_TRANSACTION",
        resourceType: "TRANSACTION",
        resourceId: tx._id.toString(),
        transactionId: tx._id,
        requestId: req.requestId,
        ipAddress: req.ip || req.connection?.remoteAddress,
        userAgent: req.headers["user-agent"],
        metadata: { amount: tx.amount, status: tx.status }
      });
    } catch (auditErr) {
      console.error("Audit log error (ADMIN_VIEWED_TRANSACTION):", auditErr.message);
    }

    logger.info("ADMIN_RESOURCE_VIEWED", {
      requestId: req.requestId,
      userId: req.user?._id?.toString(),
      role: req.user?.role,
      resource: "TRANSACTION_DETAIL",
      resourceId: tx._id.toString(),
      statusCode: 200
    });

    return res.status(200).json({
      transaction: {
        id: tx._id.toString(),
        _id: tx._id.toString(),
        amount: tx.amount,
        status: tx.status,
        idempotencyKey: tx.idempotencyKey,
        riskScore: tx.riskScore,
        riskStatus: tx.riskStatus,
        riskReasons: tx.riskReasons,
        isFirstTimeBeneficiary: tx.isFirstTimeBeneficiary,
        clientIp: tx.clientIp,
        userAgent: tx.userAgent,
        fromAccount: tx.fromAccount,
        toAccount: tx.toAccount,
        createdAt: tx.createdAt,
        updatedAt: tx.updatedAt,
        ledgerEntries
      }
    });
  } catch (error) {
    console.error("getTransactionById error:", error);
    return res.status(500).json({ message: "Failed to fetch transaction details" });
  }
}

/**
 * GET /api/admin/users
 * Paginated user monitoring with safe projections and optional name/email search
 */
async function getUsers(req, res) {
  try {
    const pagination = parsePagination(req.query);
    if (pagination.error) {
      return res.status(400).json({ message: pagination.error });
    }
    const { page, limit, skip } = pagination;

    const filter = {};

    if (req.query.search && typeof req.query.search === "string" && req.query.search.trim().length > 0) {
      const safeSearch = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: safeSearch, $options: "i" } },
        { email: { $regex: safeSearch, $options: "i" } }
      ];
    }

    const [total, users] = await Promise.all([
      userModel.countDocuments(filter),
      userModel
        .find(filter)
        .select("_id name email role createdAt updatedAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
    ]);

    const formatted = users.map(u => ({
      id: u._id.toString(),
      _id: u._id.toString(),
      name: u.name,
      email: u.email,
      role: u.role || "USER",
      createdAt: u.createdAt,
      updatedAt: u.updatedAt
    }));

    // Audit log: Admin viewed users list
    try {
      await auditService.logAuditEvent({
        actorUser: req.user?._id,
        action: "ADMIN_VIEWED_USER",
        resourceType: "USER",
        requestId: req.requestId,
        ipAddress: req.ip || req.connection?.remoteAddress,
        userAgent: req.headers["user-agent"],
        metadata: { resultCount: users.length, search: req.query.search || null }
      });
    } catch (auditErr) {
      console.error("Audit log error (ADMIN_VIEWED_USER):", auditErr.message);
    }

    logger.info("ADMIN_RESOURCE_VIEWED", {
      requestId: req.requestId,
      userId: req.user?._id?.toString(),
      role: req.user?.role,
      resource: "USERS_LIST",
      count: formatted.length,
      statusCode: 200
    });

    return res.status(200).json({
      users: formatted,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      }
    });
  } catch (error) {
    console.error("getUsers error:", error);
    return res.status(500).json({ message: "Failed to fetch users" });
  }
}

/**
 * GET /api/admin/audit-logs
 * Paginated and filtered read-only audit log retrieval
 */
async function getAuditLogs(req, res) {
  try {
    const pagination = parsePagination(req.query);
    if (pagination.error) {
      return res.status(400).json({ message: pagination.error });
    }
    const { page, limit, skip } = pagination;

    const filter = {};

    // Filter: action
    if (req.query.action) {
      filter.action = req.query.action.trim();
    }

    // Filter: resourceType
    if (req.query.resourceType) {
      const allowedResourceTypes = ["TRANSACTION", "USER", "ACCOUNT", "AUTH", "ADMIN", "RISK", "SYSTEM"];
      const upper = req.query.resourceType.trim().toUpperCase();
      if (!allowedResourceTypes.includes(upper)) {
        return res.status(400).json({ message: `Invalid resourceType filter. Allowed: ${allowedResourceTypes.join(", ")}` });
      }
      filter.resourceType = upper;
    }

    // Filter: actorUser
    if (req.query.actorUser) {
      if (!mongoose.Types.ObjectId.isValid(req.query.actorUser)) {
        return res.status(400).json({ message: "Invalid actorUser ObjectId" });
      }
      filter.actorUser = req.query.actorUser;
    }

    // Filter: transactionId
    if (req.query.transactionId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.transactionId)) {
        return res.status(400).json({ message: "Invalid transactionId ObjectId" });
      }
      filter.transactionId = req.query.transactionId;
    }

    // Filter: dateFrom / dateTo
    if (req.query.dateFrom) {
      const fromDate = new Date(req.query.dateFrom);
      if (isNaN(fromDate.getTime())) {
        return res.status(400).json({ message: "Invalid dateFrom format" });
      }
      filter.createdAt = filter.createdAt || {};
      filter.createdAt.$gte = fromDate;
    }
    if (req.query.dateTo) {
      const toDate = new Date(req.query.dateTo);
      if (isNaN(toDate.getTime())) {
        return res.status(400).json({ message: "Invalid dateTo format" });
      }
      filter.createdAt = filter.createdAt || {};
      filter.createdAt.$lte = toDate;
    }

    const [total, logs] = await Promise.all([
      auditLogModel.countDocuments(filter),
      auditLogModel
        .find(filter)
        .populate("actorUser", "name email role")
        .populate("targetUserId", "name email role")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
    ]);

    logger.info("ADMIN_RESOURCE_VIEWED", {
      requestId: req.requestId,
      userId: req.user?._id?.toString(),
      role: req.user?.role,
      resource: "AUDIT_LOGS_LIST",
      count: logs.length,
      statusCode: 200
    });

    return res.status(200).json({
      auditLogs: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      }
    });
  } catch (error) {
    console.error("getAuditLogs error:", error);
    return res.status(500).json({ message: "Failed to fetch audit logs" });
  }
}

/**
 * GET /api/admin/audit-logs/:id
 * Retrieve single audit log entry
 */
async function getAuditLogById(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid audit log ID format" });
    }

    const log = await auditLogModel
      .findById(id)
      .populate("actorUser", "name email role")
      .populate("targetUserId", "name email role");

    if (!log) {
      return res.status(404).json({ message: "Audit log not found" });
    }

    logger.info("ADMIN_RESOURCE_VIEWED", {
      requestId: req.requestId,
      userId: req.user?._id?.toString(),
      role: req.user?.role,
      resource: "AUDIT_LOG_DETAIL",
      resourceId: id,
      statusCode: 200
    });

    return res.status(200).json({ auditLog: log });
  } catch (error) {
    console.error("getAuditLogById error:", error);
    return res.status(500).json({ message: "Failed to fetch audit log" });
  }
}

module.exports = {
  getDashboardStats,
  getTransactions,
  getFlaggedTransactions,
  getTransactionById,
  getUsers,
  getAuditLogs,
  getAuditLogById
};

