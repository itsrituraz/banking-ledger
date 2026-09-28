const transactionModel = require("../models/transaction.model");

/**
 * Transparent, deterministic configuration constants for Risk Engine v1
 */
const RISK_THRESHOLDS = {
  AMOUNT: {
    HIGH: 10000,        // ₹10,000 threshold for elevated risk
    VERY_HIGH: 50000    // ₹50,000 threshold for very high risk
  },
  VELOCITY: {
    WINDOW_1M_MS: 1 * 60 * 1000,    // 1-minute velocity window
    WINDOW_5M_MS: 5 * 60 * 1000,    // 5-minute velocity window
    THRESHOLD_1M: 3,                // >= 3 transactions in 1 minute
    THRESHOLD_5M: 5                 // >= 5 transactions in 5 minutes
  },
  ACCOUNT_AGE: {
    NEW_ACCOUNT_HOURS: 24           // Created within last 24 hours
  },
  UNUSUAL_AMOUNT: {
    MIN_PRIOR_TX: 3,                // Minimum completed transactions to establish average baseline
    MULTIPLIER: 3,                  // Current transaction is > 3x average
    MIN_AMOUNT: 5000                // Minimum absolute amount to trigger unusual flag
  }
};

const RISK_POINTS = {
  HIGH_TRANSACTION_AMOUNT: 20,
  VERY_HIGH_TRANSACTION_AMOUNT: 35,
  FIRST_TIME_BENEFICIARY: 20,
  HIGH_TRANSACTION_VELOCITY: 25,
  VERY_HIGH_TRANSACTION_VELOCITY: 40,
  NEW_ACCOUNT: 10,
  UNUSUAL_TRANSACTION_AMOUNT: 15
};

const RISK_STATUS = {
  APPROVED: "APPROVED",
  FLAGGED: "FLAGGED",
  MANUAL_REVIEW: "MANUAL_REVIEW",
  BLOCKED: "BLOCKED"
};

const RISK_SCORE_TIERS = {
  APPROVED_MAX: 29,       // 0 - 29 -> APPROVED
  FLAGGED_MAX: 59,        // 30 - 59 -> FLAGGED
  MANUAL_REVIEW_MAX: 79,  // 60 - 79 -> MANUAL_REVIEW
  BLOCKED_MIN: 80         // 80 - 100 -> BLOCKED
};

/**
 * Determine risk status based on bounded score
 * @param {number} score 
 * @returns {string} RISK_STATUS
 */
function resolveRiskStatus(score) {
  if (score >= RISK_SCORE_TIERS.BLOCKED_MIN) {
    return RISK_STATUS.BLOCKED;
  }
  if (score > RISK_SCORE_TIERS.FLAGGED_MAX) {
    return RISK_STATUS.MANUAL_REVIEW;
  }
  if (score > RISK_SCORE_TIERS.APPROVED_MAX) {
    return RISK_STATUS.FLAGGED;
  }
  return RISK_STATUS.APPROVED;
}

/**
 * Calculate transaction risk deterministically
 * 
 * @param {Object} params
 * @param {Object} params.user - User document / authenticated user
 * @param {string|ObjectId} params.fromAccount - Sender Account ID
 * @param {Object} [params.fromAccountDoc] - Pre-fetched sender account document
 * @param {string|ObjectId} params.toAccount - Receiver Account ID
 * @param {Object} [params.toAccountDoc] - Pre-fetched receiver account document
 * @param {number} params.amount - Transfer amount
 * @param {Object} [params.requestMetadata] - { clientIp, userAgent }
 * @param {Object} [params.session] - Optional MongoDB session (for transactional reads if needed)
 * 
 * @returns {Promise<{
 *   riskScore: number,
 *   riskStatus: string,
 *   riskReasons: string[],
 *   isFirstTimeBeneficiary: boolean,
 *   ruleBreakdown: Object
 * }>}
 */
async function calculateTransactionRisk({
  user,
  fromAccount,
  fromAccountDoc,
  toAccount,
  toAccountDoc,
  amount,
  requestMetadata = {},
  session = null
}) {
  const riskReasons = [];
  const ruleBreakdown = {};
  let rawScore = 0;
  let isFirstTimeBeneficiary = false;

  const now = Date.now();
  const queryOptions = session ? { session } : {};

  // =========================================================================
  // RULE 1: Transaction Amount
  // =========================================================================
  if (amount >= RISK_THRESHOLDS.AMOUNT.VERY_HIGH) {
    riskReasons.push("VERY_HIGH_TRANSACTION_AMOUNT");
    rawScore += RISK_POINTS.VERY_HIGH_TRANSACTION_AMOUNT;
    ruleBreakdown.amountRule = {
      points: RISK_POINTS.VERY_HIGH_TRANSACTION_AMOUNT,
      reason: "VERY_HIGH_TRANSACTION_AMOUNT"
    };
  } else if (amount >= RISK_THRESHOLDS.AMOUNT.HIGH) {
    riskReasons.push("HIGH_TRANSACTION_AMOUNT");
    rawScore += RISK_POINTS.HIGH_TRANSACTION_AMOUNT;
    ruleBreakdown.amountRule = {
      points: RISK_POINTS.HIGH_TRANSACTION_AMOUNT,
      reason: "HIGH_TRANSACTION_AMOUNT"
    };
  } else {
    ruleBreakdown.amountRule = { points: 0, reason: null };
  }

  // =========================================================================
  // RULE 2: First-Time Beneficiary
  // Check if sender has previously completed a transaction to receiver
  // =========================================================================
  const priorCompletedTx = await transactionModel.exists(
    {
      fromAccount,
      toAccount,
      status: "COMPLETED"
    },
    queryOptions
  );

  if (!priorCompletedTx) {
    isFirstTimeBeneficiary = true;
    riskReasons.push("FIRST_TIME_BENEFICIARY");
    rawScore += RISK_POINTS.FIRST_TIME_BENEFICIARY;
    ruleBreakdown.beneficiaryRule = {
      points: RISK_POINTS.FIRST_TIME_BENEFICIARY,
      reason: "FIRST_TIME_BENEFICIARY"
    };
  } else {
    isFirstTimeBeneficiary = false;
    ruleBreakdown.beneficiaryRule = { points: 0, reason: null };
  }

  // =========================================================================
  // RULE 3: Transaction Velocity
  // Count recent transactions across sliding windows (1m and 5m)
  // =========================================================================
  const window1mStart = new Date(now - RISK_THRESHOLDS.VELOCITY.WINDOW_1M_MS);
  const window5mStart = new Date(now - RISK_THRESHOLDS.VELOCITY.WINDOW_5M_MS);

  const [count1m, count5m] = await Promise.all([
    transactionModel.countDocuments(
      {
        fromAccount,
        createdAt: { $gte: window1mStart },
        status: { $in: ["COMPLETED", "PENDING"] }
      },
      queryOptions
    ),
    transactionModel.countDocuments(
      {
        fromAccount,
        createdAt: { $gte: window5mStart },
        status: { $in: ["COMPLETED", "PENDING"] }
      },
      queryOptions
    )
  ]);

  if (count1m >= RISK_THRESHOLDS.VELOCITY.THRESHOLD_1M) {
    riskReasons.push("VERY_HIGH_TRANSACTION_VELOCITY");
    rawScore += RISK_POINTS.VERY_HIGH_TRANSACTION_VELOCITY;
    ruleBreakdown.velocityRule = {
      points: RISK_POINTS.VERY_HIGH_TRANSACTION_VELOCITY,
      reason: "VERY_HIGH_TRANSACTION_VELOCITY",
      count1m,
      count5m
    };
  } else if (count5m >= RISK_THRESHOLDS.VELOCITY.THRESHOLD_5M) {
    riskReasons.push("HIGH_TRANSACTION_VELOCITY");
    rawScore += RISK_POINTS.HIGH_TRANSACTION_VELOCITY;
    ruleBreakdown.velocityRule = {
      points: RISK_POINTS.HIGH_TRANSACTION_VELOCITY,
      reason: "HIGH_TRANSACTION_VELOCITY",
      count1m,
      count5m
    };
  } else {
    ruleBreakdown.velocityRule = { points: 0, reason: null, count1m, count5m };
  }

  // =========================================================================
  // RULE 4: Account Age
  // If account was created within the last 24 hours
  // =========================================================================
  const accountCreatedAt = fromAccountDoc?.createdAt || user?.createdAt;
  if (accountCreatedAt) {
    const ageInHours = (now - new Date(accountCreatedAt).getTime()) / (1000 * 60 * 60);
    if (ageInHours < RISK_THRESHOLDS.ACCOUNT_AGE.NEW_ACCOUNT_HOURS) {
      riskReasons.push("NEW_ACCOUNT");
      rawScore += RISK_POINTS.NEW_ACCOUNT;
      ruleBreakdown.accountAgeRule = {
        points: RISK_POINTS.NEW_ACCOUNT,
        reason: "NEW_ACCOUNT",
        ageInHours: Math.round(ageInHours * 10) / 10
      };
    } else {
      ruleBreakdown.accountAgeRule = { points: 0, reason: null, ageInHours };
    }
  } else {
    ruleBreakdown.accountAgeRule = { points: 0, reason: null, ageInHours: null };
  }

  // =========================================================================
  // RULE 5: Historical Transaction Amount Outlier
  // Compare against user's recent completed transactions
  // =========================================================================
  const recentCompletedTx = await transactionModel
    .find(
      { fromAccount, status: "COMPLETED" },
      { amount: 1 },
      queryOptions
    )
    .sort({ createdAt: -1 })
    .limit(10);

  if (recentCompletedTx.length >= RISK_THRESHOLDS.UNUSUAL_AMOUNT.MIN_PRIOR_TX) {
    const totalAmount = recentCompletedTx.reduce((sum, tx) => sum + tx.amount, 0);
    const avgAmount = totalAmount / recentCompletedTx.length;

    if (
      amount >= RISK_THRESHOLDS.UNUSUAL_AMOUNT.MIN_AMOUNT &&
      amount > avgAmount * RISK_THRESHOLDS.UNUSUAL_AMOUNT.MULTIPLIER
    ) {
      riskReasons.push("UNUSUAL_TRANSACTION_AMOUNT");
      rawScore += RISK_POINTS.UNUSUAL_TRANSACTION_AMOUNT;
      ruleBreakdown.unusualAmountRule = {
        points: RISK_POINTS.UNUSUAL_TRANSACTION_AMOUNT,
        reason: "UNUSUAL_TRANSACTION_AMOUNT",
        avgAmount: Math.round(avgAmount),
        multiplier: Math.round((amount / avgAmount) * 10) / 10
      };
    } else {
      ruleBreakdown.unusualAmountRule = { points: 0, reason: null, avgAmount };
    }
  } else {
    ruleBreakdown.unusualAmountRule = { points: 0, reason: null, note: "Insufficient history" };
  }

  // =========================================================================
  // BOUNDED SCORE & STATUS
  // Cap strictly between 0 and 100
  // =========================================================================
  const riskScore = Math.min(100, Math.max(0, rawScore));
  const riskStatus = resolveRiskStatus(riskScore);

  return {
    riskScore,
    riskStatus,
    riskReasons,
    isFirstTimeBeneficiary,
    ruleBreakdown
  };
}

module.exports = {
  calculateTransactionRisk,
  RISK_THRESHOLDS,
  RISK_POINTS,
  RISK_STATUS,
  RISK_SCORE_TIERS,
  resolveRiskStatus
};
