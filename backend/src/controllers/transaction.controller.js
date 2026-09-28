const transactionModel = require("../models/transaction.model")
const ledgerModel = require("../models/ledger.model")
const accountModel = require("../models/account.model")
const emailService = require("../services/email.service")
const riskEngineService = require("../services/riskEngine.service")
const auditService = require("../services/audit.service")
const logger = require("../utils/logger")
const mongoose = require("mongoose")

/**
 * - create a new transaction
 * The transfer flow:
 * validate request
 * validate ownership of fromAccount
 * validate idempotency key (unique index enforced at DB level)
 * check account status
 * start session/transaction
 * lock + derive sender balance from ledger (inside transaction)
 * create transaction(pending)
 * create debit ledger entry
 * create credit ledger entry
 * mark transaction completed
 * commit mongodb session
 * send email notification (best-effort, never fails the response)
 */

async function createTransaction(req, res) {
  const txStartTime = Date.now();

  /**
   * 1. validate request
   */
  const { fromAccount, toAccount, amount, idempotencyKey } = req.body

  if (!fromAccount || !toAccount || !amount || !idempotencyKey) {
    return res.status(400).json({
      message: "fromAccount, toAccount, amount and idempotencyKey are required"
    })
  }

  if (typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({
      message: "amount must be a positive number"
    })
  }

  if (fromAccount === toAccount) {
    return res.status(400).json({
      message: "fromAccount and toAccount cannot be the same"
    })
  }

  logger.info("TRANSACTION_REQUESTED", {
    requestId: req.requestId || "UNKNOWN",
    userId: req.user?._id?.toString(),
    fromAccount,
    toAccount,
    amount,
    idempotencyKey
  });

  if (!mongoose.Types.ObjectId.isValid(fromAccount) || !mongoose.Types.ObjectId.isValid(toAccount)) {
    return res.status(400).json({
      message: "Invalid fromAccount or toAccount"
    })
  }

  const [fromUserAccount, toUserAccount] = await Promise.all([
    accountModel.findOne({ _id: fromAccount }),
    accountModel.findOne({ _id: toAccount })
  ])

  if (!fromUserAccount || !toUserAccount) {
    return res.status(400).json({
      message: "Invalid fromAccount or toAccount"
    })
  }

  /**
   * 2. ownership check — req.user must own fromAccount
   */
  if (fromUserAccount.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({
      message: "You are not authorized to debit this account"
    })
  }

  /**
   * 3. check account status
   */
  if (fromUserAccount.status !== "ACTIVE" || toUserAccount.status !== "ACTIVE") {
    return res.status(400).json({
      message: "Both fromAccount and toAccount must be ACTIVE to process transaction"
    })
  }

  // Pre-check for duplicate idempotency key before starting transaction
  const existingTx = await transactionModel.findOne({ idempotencyKey })
  if (existingTx) {
    const safeExistingTx = {
      id: existingTx._id.toString(),
      _id: existingTx._id.toString(),
      fromAccount: existingTx.fromAccount,
      toAccount: existingTx.toAccount,
      amount: existingTx.amount,
      status: existingTx.status,
      idempotencyKey: existingTx.idempotencyKey,
      createdAt: existingTx.createdAt,
      updatedAt: existingTx.updatedAt
    }
    if (existingTx.status === "COMPLETED") {
      return res.status(200).json({ message: "Transaction already processed", transaction: safeExistingTx })
    }
    if (existingTx.status === "PENDING") {
      return res.status(200).json({ message: "Transaction is still processing" })
    }
    if (existingTx.status === "FAILED") {
      return res.status(400).json({ message: "Transaction previously failed, please retry with a new request", transaction: safeExistingTx })
    }
    if (existingTx.status === "REVERSED") {
      return res.status(400).json({ message: "Transaction was reversed, please retry", transaction: safeExistingTx })
    }
  }

  /**
   * 4. Risk Engine Evaluation
   */
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || req.ip || null;
  const userAgent = req.headers['user-agent'] || null;

  const riskAssessment = await riskEngineService.calculateTransactionRisk({
    user: req.user,
    fromAccount,
    fromAccountDoc: fromUserAccount,
    toAccount,
    toAccountDoc: toUserAccount,
    amount,
    requestMetadata: { clientIp, userAgent }
  });

  // Operational Log: Risk Evaluated
  logger.info("RISK_EVALUATED", {
    requestId: req.requestId || "UNKNOWN",
    userId: req.user?._id?.toString(),
    riskScore: riskAssessment.riskScore,
    riskStatus: riskAssessment.riskStatus,
    riskReasons: riskAssessment.riskReasons,
    amount
  });

  // Audit Log: Risk Evaluation Event
  try {
    await auditService.logAuditEvent({
      actorUser: req.user._id,
      action: "RISK_EVALUATED",
      resourceType: "TRANSACTION",
      resourceId: idempotencyKey,
      requestId: req.requestId,
      ipAddress: clientIp,
      userAgent,
      metadata: {
        riskScore: riskAssessment.riskScore,
        riskStatus: riskAssessment.riskStatus,
        riskReasons: riskAssessment.riskReasons,
        isFirstTimeBeneficiary: riskAssessment.isFirstTimeBeneficiary,
        amount
      }
    });
  } catch (auditErr) {
    console.error("Audit log error (RISK_EVALUATED):", auditErr.message);
  }

  if (riskAssessment.riskStatus === "BLOCKED" || riskAssessment.riskStatus === "MANUAL_REVIEW") {
    // Operational Log: Transaction Blocked / Held
    logger.warn("TRANSACTION_BLOCKED", {
      requestId: req.requestId || "UNKNOWN",
      userId: req.user?._id?.toString(),
      amount,
      riskScore: riskAssessment.riskScore,
      riskStatus: riskAssessment.riskStatus,
      riskReasons: riskAssessment.riskReasons
    });

    // Record failed transaction for compliance audit outside session
    try {
      await transactionModel.create({
        fromAccount,
        toAccount,
        amount,
        idempotencyKey,
        status: "FAILED",
        riskScore: riskAssessment.riskScore,
        riskStatus: riskAssessment.riskStatus,
        riskReasons: riskAssessment.riskReasons,
        isFirstTimeBeneficiary: riskAssessment.isFirstTimeBeneficiary,
        clientIp,
        userAgent
      });
    } catch (recErr) {
      // Ignore if idempotencyKey collision
    }

    // Audit Log: Transaction Blocked Event
    try {
      await auditService.logAuditEvent({
        actorUser: req.user._id,
        action: "TRANSACTION_BLOCKED",
        resourceType: "TRANSACTION",
        resourceId: idempotencyKey,
        requestId: req.requestId,
        ipAddress: clientIp,
        userAgent,
        metadata: {
          amount,
          fromAccount,
          toAccount,
          riskScore: riskAssessment.riskScore,
          riskStatus: riskAssessment.riskStatus,
          riskReasons: riskAssessment.riskReasons
        }
      });
    } catch (auditErr) {
      console.error("Audit log error (TRANSACTION_BLOCKED):", auditErr.message);
    }

    if (riskAssessment.riskStatus === "BLOCKED") {
      return res.status(403).json({
        message: "Transaction declined due to security policy"
      });
    } else {
      return res.status(403).json({
        message: "Transaction flagged for manual verification, please contact support"
      });
    }
  }

  const MAX_RETRIES = 10;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      /**
       * 5. CONCURRENCY ANCHOR:
       * Force MongoDB to acquire an exclusive document write-lock on the sender's Account.
       * Any concurrent transaction for the same sender account will either wait or trigger
       * a WriteConflict (TransientTransactionError), which our retry loop handles.
       */
      const lockedSenderAccount = await accountModel.findOneAndUpdate(
        { _id: fromAccount, status: "ACTIVE" },
        { $inc: { sequence: 1 }, $set: { lastTransactionAt: new Date() } },
        { session, new: true }
      );

      if (!lockedSenderAccount) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          message: "Sender account is invalid or not ACTIVE"
        });
      }

      /**
       * 6. Idempotency check-and-create inside session
       */
      let transaction;
      try {
        transaction = (await transactionModel.create([{
          fromAccount,
          toAccount,
          amount,
          idempotencyKey,
          status: "PENDING",
          riskScore: riskAssessment.riskScore,
          riskStatus: riskAssessment.riskStatus,
          riskReasons: riskAssessment.riskReasons,
          isFirstTimeBeneficiary: riskAssessment.isFirstTimeBeneficiary,
          clientIp,
          userAgent
        }], { session }))[0];

        // Operational Log: Transaction Created (Pending)
        logger.info("TRANSACTION_CREATED", {
          requestId: req.requestId || "UNKNOWN",
          transactionId: transaction._id.toString(),
          userId: req.user._id.toString(),
          amount,
          status: "PENDING"
        });

        // Audit Log: Transaction Created inside session
        await auditService.logAuditEvent({
          actorUser: req.user._id,
          action: "TRANSACTION_CREATED",
          resourceType: "TRANSACTION",
          resourceId: transaction._id.toString(),
          transactionId: transaction._id,
          requestId: req.requestId,
          ipAddress: clientIp,
          userAgent,
          metadata: { amount, fromAccount, toAccount, idempotencyKey },
          session
        });
      } catch (createErr) {
        if (createErr.code === 11000) {
          await session.abortTransaction();
          session.endSession();

          const existing = await transactionModel.findOne({ idempotencyKey });
          if (!existing) {
            return res.status(409).json({ message: "Duplicate idempotency key, please retry" });
          }
          const safeExisting = {
            id: existing._id.toString(),
            _id: existing._id.toString(),
            fromAccount: existing.fromAccount,
            toAccount: existing.toAccount,
            amount: existing.amount,
            status: existing.status,
            idempotencyKey: existing.idempotencyKey,
            createdAt: existing.createdAt,
            updatedAt: existing.updatedAt
          };
          if (existing.status === "COMPLETED") {
            return res.status(200).json({ message: "Transaction already processed", transaction: safeExisting });
          }
          if (existing.status === "PENDING") {
            return res.status(200).json({ message: "Transaction is still processing" });
          }
          if (existing.status === "FAILED") {
            return res.status(400).json({ message: "Transaction previously failed, please retry with a new request", transaction: safeExisting });
          }
          if (existing.status === "REVERSED") {
            return res.status(400).json({ message: "Transaction was reversed, please retry", transaction: safeExisting });
          }
          return res.status(409).json({ message: "Duplicate idempotency key" });
        }
        throw createErr;
      }

      /**
       * 7. Derive sender balance from ledger INSIDE the session.
       * Because we hold the exclusive write-lock on fromAccount, no other transaction
       * could have updated or inserted ledger debits since our lock was acquired.
       */
      const balance = await fromUserAccount.getBalance({ session });

      if (balance < amount) {
        await session.abortTransaction();
        session.endSession();

        // Operational Log: Transaction Failed
        logger.warn("TRANSACTION_FAILED", {
          requestId: req.requestId || "UNKNOWN",
          userId: req.user._id.toString(),
          reason: "INSUFFICIENT_BALANCE",
          amount,
          balance
        });

        // Record failed transaction in history outside session
        try {
          await transactionModel.create({
            fromAccount,
            toAccount,
            amount,
            idempotencyKey,
            status: "FAILED",
            riskScore: riskAssessment.riskScore,
            riskStatus: riskAssessment.riskStatus,
            riskReasons: riskAssessment.riskReasons,
            isFirstTimeBeneficiary: riskAssessment.isFirstTimeBeneficiary,
            clientIp,
            userAgent
          });
        } catch (failedErr) {
          // If already recorded or collision, ignore
        }

        // Audit Log: Transaction Failed
        try {
          await auditService.logAuditEvent({
            actorUser: req.user._id,
            action: "TRANSACTION_FAILED",
            resourceType: "TRANSACTION",
            resourceId: idempotencyKey,
            requestId: req.requestId,
            ipAddress: clientIp,
            userAgent,
            metadata: { reason: "INSUFFICIENT_BALANCE", amount, balance }
          });
        } catch (auditErr) {
          console.error("Audit log error (TRANSACTION_FAILED):", auditErr.message);
        }

        return res.status(400).json({
          message: `Insufficient balance. Current balance is ${balance}. Requested amount is ${amount}`
        });
      }

      /**
       * 8. Debit + Credit ledger entries
       */
      await ledgerModel.create([{
        account: fromAccount,
        amount: amount,
        transaction: transaction._id,
        type: "DEBIT"
      }], { session });

      await ledgerModel.create([{
        account: toAccount,
        amount: amount,
        transaction: transaction._id,
        type: "CREDIT"
      }], { session });

      // Operational Log: Double-entry ledger records
      logger.info("LEDGER_ENTRY_CREATED", {
        requestId: req.requestId || "UNKNOWN",
        transactionId: transaction._id.toString(),
        entryType: "DEBIT",
        account: fromAccount,
        amount
      });
      logger.info("LEDGER_ENTRY_CREATED", {
        requestId: req.requestId || "UNKNOWN",
        transactionId: transaction._id.toString(),
        entryType: "CREDIT",
        account: toAccount,
        amount
      });

      const updatedTx = await transactionModel.findOneAndUpdate(
        { _id: transaction._id },
        { status: "COMPLETED" },
        { session, new: true }
      );

      // Audit Log: Transaction Completed inside session (atomic with commit)
      await auditService.logAuditEvent({
        actorUser: req.user._id,
        action: "TRANSACTION_COMPLETED",
        resourceType: "TRANSACTION",
        resourceId: transaction._id.toString(),
        transactionId: transaction._id,
        requestId: req.requestId,
        ipAddress: clientIp,
        userAgent,
        metadata: { amount, fromAccount, toAccount, idempotencyKey },
        session
      });

      await session.commitTransaction();
      session.endSession();

      // Operational Log: Transaction Completed with duration
      logger.info("TRANSACTION_COMPLETED", {
        requestId: req.requestId || "UNKNOWN",
        transactionId: transaction._id.toString(),
        userId: req.user._id.toString(),
        amount,
        durationMs: Date.now() - txStartTime
      });

      /**
       * 9. Send email notification (non-blocking)
       */
      emailService.sendTransactionEmail(
        req.user.email, req.user.name, amount, toAccount
      ).catch(emailErr => {
        console.error("Failed to send transaction email:", emailErr?.message || emailErr);
      });

      const finalTx = updatedTx ? updatedTx.toObject() : { ...transaction.toObject(), status: "COMPLETED" };

      const safeTx = {
        id: finalTx._id.toString(),
        _id: finalTx._id.toString(),
        fromAccount: finalTx.fromAccount,
        toAccount: finalTx.toAccount,
        amount: finalTx.amount,
        status: finalTx.status,
        idempotencyKey: finalTx.idempotencyKey,
        createdAt: finalTx.createdAt,
        updatedAt: finalTx.updatedAt
      };

      return res.status(201).json({
        message: "Transaction completed successfully",
        transaction: safeTx
      });

    } catch (error) {
      if (session.inTransaction()) {
        try {
          await session.abortTransaction();
        } catch (abortErr) {
          // session already aborted by driver on write conflict
        }
      }
      session.endSession();

      // Check if transient transaction error / write conflict
      const isTransient =
        (typeof error.hasErrorLabel === 'function' && error.hasErrorLabel('TransientTransactionError')) ||
        (typeof error.hasErrorLabel === 'function' && error.hasErrorLabel('UnknownTransactionCommitResult')) ||
        error.code === 112 ||
        (error.message && error.message.includes('WriteConflict'));

      if (isTransient && attempt < MAX_RETRIES) {
        // Exponential backoff with random jitter
        const delay = Math.min(20 * Math.pow(1.4, attempt - 1) + Math.floor(Math.random() * 40), 350);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      console.error(`createTransaction attempt ${attempt} failed:`, error.message);

      return res.status(isTransient ? 409 : 500).json({
        message: isTransient
          ? "Transaction conflict due to high concurrency, please retry"
          : "Transaction failed due to some issue, please retry after some time"
      });
    }
  }
}

async function createInitialFundsTransaction(req, res) {
  const { toAccount, amount, idempotencyKey } = req.body

  if (!toAccount || !amount || !idempotencyKey) {
    return res.status(400).json({
      message: "toAccount, amount and idempotencyKey are required"
    })
  }

  if (typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({
      message: "amount must be a positive number"
    })
  }

  const toUserAccount = await accountModel.findOne({ _id: toAccount })
  if (!toUserAccount) {
    return res.status(400).json({
      message: "Invalid toAccount"
    })
  }

  const fromUserAccount = await accountModel.findOne({
    //systemUser: true,
    user: req.user._id
  })

  if (!fromUserAccount) {
    return res.status(400).json({
      message: "System user account not found"
    })
  }

  const session = await mongoose.startSession()

  try {
    session.startTransaction()

    let transaction
    try {
      transaction = (await transactionModel.create([{
        account: fromUserAccount._id,
        fromAccount: fromUserAccount._id,
        toAccount,
        amount,
        idempotencyKey,
        status: "PENDING"
      }], { session }))[0]
    } catch (createErr) {
      if (createErr.code === 11000) {
        await session.abortTransaction()
        session.endSession()

        const existing = await transactionModel.findOne({ idempotencyKey })
        if (existing && existing.status === "COMPLETED") {
          return res.status(200).json({ message: "Transaction already processed", transaction: existing })
        }
        return res.status(200).json({ message: "Transaction is still processing or was already submitted" })
      }
      throw createErr
    }

    await ledgerModel.create([{
      account: fromUserAccount._id,
      amount: amount,
      transaction: transaction._id,
      type: "DEBIT"
    }], { session })

    await ledgerModel.create([{
      account: toAccount,
      amount: amount,
      transaction: transaction._id,
      type: "CREDIT"
    }], { session })

    const updatedTx = await transactionModel.findOneAndUpdate(
      { _id: transaction._id },
      { status: "COMPLETED" },
      { session, new: true }
    )

    await session.commitTransaction()
    session.endSession()

    const finalTx = updatedTx ? updatedTx.toObject() : { ...transaction.toObject(), status: "COMPLETED" };

    return res.status(201).json({
      message: "Initial funds transaction completed successfully",
      transaction: {
        ...finalTx,
        id: finalTx._id.toString()
      }
    })

  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction()
    }
    session.endSession()

    console.error("createInitialFundsTransaction failed:", error)

    return res.status(500).json({
      message: "Transaction failed due to some issue, please retry after some time"
    })
  }
}

async function getTransactions(req, res) {
  try {
    const userAccounts = await accountModel.find({ user: req.user._id });
    if (!userAccounts || userAccounts.length === 0) {
      const newAcc = await accountModel.create({ user: req.user._id });
      userAccounts.push(newAcc);
    }

    const accountIds = userAccounts.map(a => a._id.toString());
    const accountObjectIds = userAccounts.map(a => a._id);

    const rawTransactions = await transactionModel
      .find({
        $or: [
          { fromAccount: { $in: accountObjectIds } },
          { toAccount: { $in: accountObjectIds } }
        ]
      })
      .populate({
        path: "fromAccount",
        populate: { path: "user", select: "name email" }
      })
      .populate({
        path: "toAccount",
        populate: { path: "user", select: "name email" }
      })
      .sort({ createdAt: -1 });

    const items = rawTransactions.map((tx) => {
      const fromAccId = (tx.fromAccount?._id || tx.fromAccount)?.toString();
      const toAccId = (tx.toAccount?._id || tx.toAccount)?.toString();

      const isRecipient = accountIds.includes(toAccId);
      const isSender = accountIds.includes(fromAccId);

      // A transaction is a credit if this user received the money (or if it's a self-seed deposit)
      const isCredit = isRecipient && (!isSender || fromAccId === toAccId);
      const counterparty = isCredit
        ? (tx.fromAccount?.user?.name || "System Deposit")
        : (tx.toAccount?.user?.name || "Recipient Account");

      return {
        id: tx._id.toString(),
        _id: tx._id.toString(),
        fromAccount: fromAccId,
        toAccount: toAccId,
        amount: tx.amount,
        status: tx.status,
        type: isCredit ? "credit" : "debit",
        counterparty,
        idempotencyKey: tx.idempotencyKey,
        createdAt: tx.createdAt,
        updatedAt: tx.updatedAt
      };
    });

    const { type, limit } = req.query;
    let filtered = items;
    if (type && type !== "all") {
      filtered = filtered.filter(tx => tx.type?.toLowerCase() === type.toLowerCase());
    }

    const limitNum = parseInt(limit, 10);
    const resultItems = !isNaN(limitNum) && limitNum > 0 ? filtered.slice(0, limitNum) : filtered;

    res.status(200).json({
      items: resultItems,
      total: filtered.length
    });
  } catch (error) {
    console.error("getTransactions error:", error);
    res.status(500).json({ message: "Failed to fetch transactions" });
  }
}

module.exports = { createTransaction, createInitialFundsTransaction, getTransactions }