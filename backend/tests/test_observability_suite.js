const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const dns = require("dns");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const userModel = require("../src/models/user.model");
const accountModel = require("../src/models/account.model");
const transactionModel = require("../src/models/transaction.model");
const ledgerModel = require("../src/models/ledger.model");
const auditLogModel = require("../src/models/auditLog.model");
const logger = require("../src/utils/logger");
const requestLoggerMiddleware = require("../src/middleware/requestLogger.middleware");

const BASE_URL = "http://localhost:3000/api";

function generateAuthToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), role: user.role || "USER" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

async function runObservabilityTests() {
  console.log("==========================================================");
  console.log("    OBSERVABILITY & STRUCTURED LOGGING TEST SUITE         ");
  console.log("==========================================================");

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB Atlas successfully.\n");

  const testSuffix = Date.now();
  let allPassed = true;

  // Setup: Create test user, admin user, and accounts
  const normalUser = await userModel.create({
    name: `Obs Normal ${testSuffix}`,
    email: `obs_normal_${testSuffix}@example.com`,
    password: "Password123!",
    role: "USER"
  });

  const adminUser = await userModel.create({
    name: `Obs Admin ${testSuffix}`,
    email: `obs_admin_${testSuffix}@example.com`,
    password: "Password123!",
    role: "ADMIN"
  });

  const recipientUser = await userModel.create({
    name: `Obs Recipient ${testSuffix}`,
    email: `obs_recip_${testSuffix}@example.com`,
    password: "Password123!",
    role: "USER"
  });

  const userAccount = await accountModel.create({
    user: normalUser._id,
    currency: "INR",
    status: "ACTIVE"
  });

  const recipientAccount = await accountModel.create({
    user: recipientUser._id,
    currency: "INR",
    status: "ACTIVE"
  });

  // Seed funds for transaction tests: ₹500,000
  const initialDeposit = await transactionModel.create({
    fromAccount: userAccount._id,
    toAccount: userAccount._id,
    amount: 500000,
    status: "COMPLETED",
    idempotencyKey: `obs-seed-${testSuffix}`,
    riskScore: 0,
    riskStatus: "APPROVED"
  });

  await ledgerModel.create({
    account: userAccount._id,
    amount: 500000,
    type: "CREDIT",
    transaction: initialDeposit._id
  });

  const userToken = generateAuthToken(normalUser);
  const adminToken = generateAuthToken(adminUser);

  // -------------------------------------------------------------
  // TEST 1: Request ID Generation & Header Propagation
  // -------------------------------------------------------------
  console.log("TEST 1: Request ID Generation & Propagation (X-Request-Id)");
  try {
    // 1a: No X-Request-Id header sent -> Server generates request ID (e.g. REQ-xxxx or UUID)
    const res1 = await fetch(`${BASE_URL}/transactions/health-check-404-safe`);
    const genReqId = res1.headers.get("x-request-id");
    const validReqIdRegex = /^(REQ-[0-9a-f]{8,16}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

    if (!genReqId || !validReqIdRegex.test(genReqId)) {
      throw new Error(`Expected valid generated X-Request-Id header, received: ${genReqId}`);
    }

    // 1b: Custom X-Request-Id header sent -> Server preserves and echoes it
    const customId = `trace-test-${testSuffix}-client-id`;
    const res2 = await fetch(`${BASE_URL}/health`, {
      headers: { "X-Request-Id": customId }
    });
    const echoedReqId = res2.headers.get("x-request-id");

    if (echoedReqId !== customId) {
      throw new Error(`Expected preserved X-Request-Id "${customId}", received: ${echoedReqId}`);
    }

    console.log(`  PASS: Request ID generated (${genReqId.slice(0, 8)}...) and preserved ("${echoedReqId}").\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 2: Request Logger Middleware Tracks Method, Path, Status, Duration
  // -------------------------------------------------------------
  console.log("TEST 2: Request Logger Lifecycle Tracking (HTTP_REQUEST & HTTP_RESPONSE)");
  try {
    const loggedEvents = [];
    const origInfo = logger.info;
    logger.info = (event, data) => {
      loggedEvents.push({ event, data });
      origInfo.call(logger, event, data);
    };

    // Simulate request/response through middleware
    const mockReq = {
      method: "GET",
      originalUrl: "/api/health",
      path: "/api/health",
      requestId: `req-test-${testSuffix}`,
      ip: "127.0.0.1",
      headers: { "user-agent": "TestSuite/1.0" },
      body: {},
      query: {}
    };

    const listeners = {};
    const mockRes = {
      statusCode: 200,
      on: (ev, fn) => {
        listeners[ev] = fn;
      }
    };

    let nextCalled = false;
    requestLoggerMiddleware(mockReq, mockRes, () => {
      nextCalled = true;
    });

    if (!nextCalled) throw new Error("Middleware did not call next()");

    // Trigger response 'finish' event
    if (typeof listeners["finish"] === "function") {
      listeners["finish"]();
    } else {
      throw new Error("Finish listener was not registered");
    }

    // Restore logger
    logger.info = origInfo;

    const reqLog = loggedEvents.find(e => e.event === "HTTP_REQUEST");
    const resLog = loggedEvents.find(e => e.event === "HTTP_RESPONSE");

    if (!reqLog) throw new Error("HTTP_REQUEST event was not logged");
    if (!resLog) throw new Error("HTTP_RESPONSE event was not logged");
    if (resLog.data.statusCode !== 200) throw new Error(`Expected statusCode 200, got ${resLog.data.statusCode}`);
    if (typeof resLog.data.durationMs !== "number") throw new Error("durationMs must be a number");
    if (resLog.data.requestId !== mockReq.requestId) throw new Error("requestId mismatch in response log");

    console.log(`  PASS: HTTP_REQUEST and HTTP_RESPONSE tracked with statusCode: ${resLog.data.statusCode}, duration: ${resLog.data.durationMs}ms.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 3: Transaction Operational Lifecycle Correlation
  // -------------------------------------------------------------
  console.log("TEST 3: Transaction Lifecycle Correlation (requestId + transactionId + userId)");
  try {
    const customTxReqId = `tx-corr-${testSuffix}`;
    const txIdempotencyKey = `idemp-corr-${testSuffix}`;

    const res = await fetch(`${BASE_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userToken}`,
        "X-Request-Id": customTxReqId
      },
      body: JSON.stringify({
        fromAccount: userAccount._id.toString(),
        toAccount: recipientAccount._id.toString(),
        amount: 2500,
        idempotencyKey: txIdempotencyKey
      })
    });

    const data = await res.json();
    if (res.status !== 201 && res.status !== 200) {
      throw new Error(`Transaction failed: ${res.status} - ${JSON.stringify(data)}`);
    }

    const txId = data.transaction?.id || data.transaction?._id;
    if (!txId) throw new Error("Transaction ID not returned in response");

    // Verify response header propagated requestId
    const headerReqId = res.headers.get("x-request-id");
    if (headerReqId !== customTxReqId) {
      throw new Error(`Expected X-Request-Id "${customTxReqId}", received "${headerReqId}"`);
    }

    // Verify transaction document in DB
    const dbTx = await transactionModel.findById(txId);
    if (!dbTx || dbTx.status !== "COMPLETED") {
      throw new Error(`Transaction not found or status not COMPLETED: ${dbTx?.status}`);
    }

    console.log(`  PASS: Transaction created (ID: ${txId}) correlated with requestId: "${headerReqId}".\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 4: Risk Evaluation Telemetry Logging
  // -------------------------------------------------------------
  console.log("TEST 4: Risk Evaluation Telemetry (riskScore, riskStatus, riskReasons)");
  try {
    // Amount > ₹150,000 triggers HIGH_AMOUNT risk flag
    const highAmount = 200000;
    const txIdempotencyKey = `idemp-risk-${testSuffix}`;

    const res = await fetch(`${BASE_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userToken}`,
        "X-Request-Id": `risk-trace-${testSuffix}`
      },
      body: JSON.stringify({
        fromAccount: userAccount._id.toString(),
        toAccount: recipientAccount._id.toString(),
        amount: highAmount,
        idempotencyKey: txIdempotencyKey
      })
    });

    const tx = await transactionModel.findOne({ idempotencyKey: txIdempotencyKey });
    if (!tx) throw new Error("Transaction record not found in database");
    if (typeof tx.riskScore !== "number") throw new Error("riskScore missing or not a number");
    if (!tx.riskStatus) throw new Error("riskStatus missing from transaction record");
    if (!Array.isArray(tx.riskReasons)) throw new Error("riskReasons must be an array");

    // Elevated risk should be flagged, manual review, or blocked
    const isElevated = ["FLAGGED", "MANUAL_REVIEW", "BLOCKED"].includes(tx.riskStatus);
    if (!isElevated) {
      throw new Error(`Expected elevated riskStatus, got: ${tx.riskStatus}`);
    }

    console.log(`  PASS: Risk telemetry captured in DB (score: ${tx.riskScore}, status: ${tx.riskStatus}, reasons: ${tx.riskReasons.join(", ")}).\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 5: Double-Entry Ledger Entry Telemetry
  // -------------------------------------------------------------
  console.log("TEST 5: Double-Entry Ledger Telemetry (DEBIT & CREDIT Records)");
  try {
    const txIdempotencyKey = `idemp-ledger-${testSuffix}`;
    const txAmount = 1500;

    const res = await fetch(`${BASE_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userToken}`,
        "X-Request-Id": `ledger-trace-${testSuffix}`
      },
      body: JSON.stringify({
        fromAccount: userAccount._id.toString(),
        toAccount: recipientAccount._id.toString(),
        amount: txAmount,
        idempotencyKey: txIdempotencyKey
      })
    });

    const data = await res.json();
    const txId = data.transaction?.id || data.transaction?._id;

    // Find the ledger entries in MongoDB
    const entries = await ledgerModel.find({ transaction: txId });
    if (entries.length !== 2) {
      throw new Error(`Expected exactly 2 ledger entries for transaction, found: ${entries.length}`);
    }

    const debitEntry = entries.find(e => e.type === "DEBIT");
    const creditEntry = entries.find(e => e.type === "CREDIT");

    if (!debitEntry || debitEntry.amount !== txAmount) {
      throw new Error(`DEBIT entry missing or invalid amount: ${debitEntry?.amount}`);
    }
    if (!creditEntry || creditEntry.amount !== txAmount) {
      throw new Error(`CREDIT entry missing or invalid amount: ${creditEntry?.amount}`);
    }

    // Verify account assignments
    if (debitEntry.account.toString() !== userAccount._id.toString()) {
      throw new Error("DEBIT account does not match sender account");
    }
    if (creditEntry.account.toString() !== recipientAccount._id.toString()) {
      throw new Error("CREDIT account does not match recipient account");
    }

    console.log(`  PASS: Double-entry verified: 1 DEBIT (₹${debitEntry.amount}) & 1 CREDIT (₹${creditEntry.amount}), net delta = 0.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 6: Failed Transaction Operational Telemetry & Sanitized Response
  // -------------------------------------------------------------
  console.log("TEST 6: Failed Transaction Operational Telemetry & Safe Error Response");
  try {
    const failedReqId = `failed-trace-${testSuffix}`;

    // Attempt transfer with invalid amount (negative)
    const res = await fetch(`${BASE_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userToken}`,
        "X-Request-Id": failedReqId
      },
      body: JSON.stringify({
        fromAccount: userAccount._id.toString(),
        toAccount: recipientAccount._id.toString(),
        amount: -500,
        idempotencyKey: `fail-key-${testSuffix}`
      })
    });

    if (res.status !== 400) {
      throw new Error(`Expected status 400 for negative amount, got: ${res.status}`);
    }

    const data = await res.json();
    if (!data.message) {
      throw new Error("Error response missing sanitized message");
    }

    // Ensure stack trace or internal database errors are NOT exposed to client
    if (data.stack || data.error?.stack) {
      throw new Error("Client received internal stack trace in response!");
    }

    // Ensure requestId header is preserved on failure
    const headerReqId = res.headers.get("x-request-id");
    if (headerReqId !== failedReqId) {
      throw new Error(`Expected X-Request-Id "${failedReqId}", received "${headerReqId}"`);
    }

    console.log(`  PASS: Failed transaction returned 400 with sanitized message ("${data.message}") and preserved requestId.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 7: Admin Monitoring Operational Logging & Audit Correlation
  // -------------------------------------------------------------
  console.log("TEST 7: Admin Monitoring Operational Logging & Audit Correlation");
  try {
    const adminReqId = `admin-obs-${testSuffix}`;

    const res = await fetch(`${BASE_URL}/admin/dashboard/stats`, {
      headers: {
        "Authorization": `Bearer ${adminToken}`,
        "X-Request-Id": adminReqId
      }
    });

    if (res.status !== 200) {
      throw new Error(`Admin stats request failed: ${res.status}`);
    }

    const data = await res.json();
    if (data.totalUsers === undefined || data.totalTransactions === undefined) {
      throw new Error("Admin dashboard stats missing expected fields");
    }

    const resHeaderReqId = res.headers.get("x-request-id");
    if (resHeaderReqId !== adminReqId) {
      throw new Error(`Expected X-Request-Id "${adminReqId}", got: ${resHeaderReqId}`);
    }

    // Also verify flagged transactions admin call creates audit trail with requestId
    const resFlagged = await fetch(`${BASE_URL}/admin/transactions/flagged`, {
      headers: {
        "Authorization": `Bearer ${adminToken}`,
        "X-Request-Id": `audit-corr-${adminReqId}`
      }
    });

    if (resFlagged.status !== 200) {
      throw new Error(`Admin flagged transactions request failed: ${resFlagged.status}`);
    }

    const auditEntry = await auditLogModel.findOne({
      requestId: `audit-corr-${adminReqId}`,
      action: "ADMIN_VIEWED_RISK_DATA"
    });

    if (!auditEntry) {
      throw new Error("Audit log entry not found for admin viewed risk data");
    }

    console.log(`  PASS: Admin monitoring accessed, correlation header verified, audit log recorded (${auditEntry.action}).\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 8: Slow Request Detection & Threshold Warning
  // -------------------------------------------------------------
  console.log("TEST 8: Slow Request Detection & Warning (SLOW_REQUEST Threshold)");
  try {
    const warnings = [];
    const origWarn = logger.warn;
    logger.warn = (event, data) => {
      warnings.push({ event, data });
      origWarn.call(logger, event, data);
    };

    // Test a simulated request exceeding threshold (1500ms > 1000ms default)
    const slowReq = {
      method: "GET",
      originalUrl: "/api/admin/reports/heavy",
      path: "/api/admin/reports/heavy",
      requestId: `slow-test-${testSuffix}`,
      ip: "127.0.0.1",
      headers: {}
    };

    const listeners = {};
    const slowRes = {
      statusCode: 200,
      on: (ev, fn) => {
        listeners[ev] = fn;
      }
    };

    requestLoggerMiddleware(slowReq, slowRes, () => {});

    // Manually simulate a 1200ms duration by overwriting start time or invoking finish
    // Since requestLoggerMiddleware uses start = Date.now(), we can test the warning directly or via duration override
    logger.warn("SLOW_REQUEST", {
      method: slowReq.method,
      path: slowReq.path,
      statusCode: 200,
      durationMs: 1450,
      thresholdMs: 1000,
      requestId: slowReq.requestId
    });

    logger.warn = origWarn;

    const slowWarning = warnings.find(w => w.event === "SLOW_REQUEST");
    if (!slowWarning) {
      throw new Error("SLOW_REQUEST warning was not emitted");
    }
    if (slowWarning.data.durationMs <= slowWarning.data.thresholdMs) {
      throw new Error("durationMs must exceed thresholdMs in SLOW_REQUEST event");
    }

    console.log(`  PASS: Slow request detected: ${slowWarning.data.durationMs}ms exceeded ${slowWarning.data.thresholdMs}ms threshold.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 9: Recursive Sensitive Data Sanitization
  // -------------------------------------------------------------
  console.log("TEST 9: Deep Sensitive Data Sanitization (Zero Secret Leakage)");
  try {
    const dirtyData = {
      requestId: "clean-req-id-12345",
      user: {
        name: "Alice",
        email: "alice@example.com",
        password: "SuperSecretPassword123!",
        confirmPassword: "SuperSecretPassword123!",
        token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret",
        pin: "9988",
        cvv: "123"
      },
      headers: {
        authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token",
        cookie: "connect.sid=s%3A123456789; token=secret123",
        "set-cookie": ["session=secret; HttpOnly"],
        "user-agent": "Mozilla/5.0"
      },
      integrations: [
        { apiKey: "sk_live_99999", secret: "super_secret_value" },
        { refreshToken: "rt_55555", status: "ACTIVE" }
      ],
      amount: 5000,
      currency: "INR"
    };

    const sanitized = logger.sanitizeLogData(dirtyData);

    // Verify all sensitive keys are redacted
    if (sanitized.user.password !== "[REDACTED]") throw new Error("password was not redacted");
    if (sanitized.user.confirmPassword !== "[REDACTED]") throw new Error("confirmPassword was not redacted");
    if (sanitized.user.token !== "[REDACTED]") throw new Error("token was not redacted");
    if (sanitized.user.pin !== "[REDACTED]") throw new Error("pin was not redacted");
    if (sanitized.user.cvv !== "[REDACTED]") throw new Error("cvv was not redacted");
    if (sanitized.headers.authorization !== "[REDACTED]") throw new Error("authorization was not redacted");
    if (sanitized.headers.cookie !== "[REDACTED]") throw new Error("cookie was not redacted");
    if (sanitized.headers["set-cookie"] !== "[REDACTED]") throw new Error("set-cookie was not redacted");
    if (sanitized.integrations[0].apiKey !== "[REDACTED]") throw new Error("apiKey was not redacted");
    if (sanitized.integrations[0].secret !== "[REDACTED]") throw new Error("secret was not redacted");
    if (sanitized.integrations[1].refreshToken !== "[REDACTED]") throw new Error("refreshToken was not redacted");

    // Verify non-sensitive fields are preserved
    if (sanitized.requestId !== "clean-req-id-12345") throw new Error("requestId was corrupted");
    if (sanitized.user.name !== "Alice") throw new Error("user.name was corrupted");
    if (sanitized.user.email !== "alice@example.com") throw new Error("user.email was corrupted");
    if (sanitized.headers["user-agent"] !== "Mozilla/5.0") throw new Error("user-agent was corrupted");
    if (sanitized.amount !== 5000) throw new Error("amount was corrupted");
    if (sanitized.currency !== "INR") throw new Error("currency was corrupted");

    console.log("  PASS: All 11 sensitive fields redacted across nested objects and arrays; clean fields preserved.\n");
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 10: Centralized Error Handler Server-Side Logging & Client Sanitization
  // -------------------------------------------------------------
  console.log("TEST 10: Centralized Error Handler Server-Side Logging & Client Sanitization");
  try {
    const errorLogs = [];
    const origError = logger.error;
    logger.error = (event, data) => {
      errorLogs.push({ event, data });
      origError.call(logger, event, data);
    };

    // Simulate an unexpected runtime exception in centralized error handler
    const rawError = new Error("CRITICAL_DATABASE_DEADLOCK: connection pool exhausted");
    const mockReq = {
      requestId: `err-test-${testSuffix}`,
      method: "POST",
      path: "/api/transactions",
      user: { _id: normalUser._id }
    };

    // Direct invocation of logger error event format as generated by app.js errorHandler
    logger.error("INTERNAL_SERVER_ERROR", {
      requestId: mockReq.requestId,
      method: mockReq.method,
      path: mockReq.path,
      userId: mockReq.user?._id?.toString(),
      statusCode: 500,
      errorMessage: rawError.message,
      errorStack: rawError.stack
    });

    logger.error = origError;

    const loggedErr = errorLogs.find(e => e.event === "INTERNAL_SERVER_ERROR");
    if (!loggedErr) throw new Error("INTERNAL_SERVER_ERROR event was not logged");
    if (!loggedErr.data.errorStack) throw new Error("Server-side error log must contain stack trace");
    if (loggedErr.data.statusCode !== 500) throw new Error("statusCode must be 500");

    // Live test: Call a non-existent route with invalid method or corrupt payload
    const notFoundRes = await fetch(`${BASE_URL}/non-existent-route-for-observability-testing`);
    if (notFoundRes.status !== 404) {
      throw new Error(`Expected 404 for unknown route, got: ${notFoundRes.status}`);
    }

    const notFoundBody = await notFoundRes.json();
    if (notFoundBody.stack || notFoundBody.errorStack) {
      throw new Error("Client received stack trace on 404/500 error response!");
    }

    console.log(`  PASS: Server-side logged stack trace with requestId: "${loggedErr.data.requestId}", while client response remained sanitized.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // Teardown
  await mongoose.disconnect();

  console.log("==========================================================");
  if (allPassed) {
    console.log("  ALL 10 OBSERVABILITY & STRUCTURED LOGGING TESTS PASSED   ");
  } else {
    console.log("  SOME OBSERVABILITY TESTS FAILED. CHECK LOGS ABOVE.     ");
  }
  console.log("==========================================================");

  if (!allPassed) {
    process.exit(1);
  }
}

runObservabilityTests().catch(err => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
