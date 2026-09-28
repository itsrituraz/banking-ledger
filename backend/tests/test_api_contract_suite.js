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

const BASE_URL = "http://localhost:3000/api";

function generateAuthToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), role: user.role || "USER" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

// Contract validation helpers
function assertType(val, expectedType, fieldName) {
  if (typeof val !== expectedType) {
    throw new Error(`Contract failure: Expected "${fieldName}" to be ${expectedType}, got ${typeof val}`);
  }
}

function assertFieldsPresent(obj, fields, context) {
  if (!obj || typeof obj !== "object") {
    throw new Error(`Contract failure: ${context} is not an object`);
  }
  for (const f of fields) {
    if (obj[f] === undefined) {
      throw new Error(`Contract failure: Missing expected field "${f}" in ${context}`);
    }
  }
}

async function runApiContractTests() {
  console.log("==========================================================");
  console.log("        API DOCUMENTATION & CONTRACT TEST SUITE           ");
  console.log("==========================================================");

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB Atlas successfully.\n");

  const testSuffix = Date.now();
  let allPassed = true;

  // Setup: Create test user, admin user, and accounts
  const passwordPlain = "Password123!";
  const normalUser = await userModel.create({
    name: `Contract Normal ${testSuffix}`,
    email: `contract_normal_${testSuffix}@example.com`,
    password: passwordPlain,
    role: "USER"
  });

  const adminUser = await userModel.create({
    name: `Contract Admin ${testSuffix}`,
    email: `contract_admin_${testSuffix}@example.com`,
    password: passwordPlain,
    role: "ADMIN"
  });

  const recipientUser = await userModel.create({
    name: `Contract Recipient ${testSuffix}`,
    email: `contract_recip_${testSuffix}@example.com`,
    password: passwordPlain,
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

  // Seed user with funds for contract transactions (₹200,000)
  const depositTx = await transactionModel.create({
    fromAccount: userAccount._id,
    toAccount: userAccount._id,
    amount: 200000,
    status: "COMPLETED",
    idempotencyKey: `contract-seed-${testSuffix}`,
    riskScore: 0,
    riskStatus: "APPROVED"
  });

  await ledgerModel.create({
    account: userAccount._id,
    amount: 200000,
    type: "CREDIT",
    transaction: depositTx._id
  });

  const userToken = generateAuthToken(normalUser);
  const adminToken = generateAuthToken(adminUser);

  // -------------------------------------------------------------
  // TEST 1: Login Response Matches Documented Schema
  // -------------------------------------------------------------
  console.log("TEST 1: Login Response Matches Documented Contract Schema");
  try {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: normalUser.email,
        password: passwordPlain
      })
    });

    if (res.status !== 200) {
      throw new Error(`Expected 200 OK, got ${res.status}`);
    }

    const data = await res.json();
    assertFieldsPresent(data, ["user", "token"], "Login Response");
    assertFieldsPresent(data.user, ["_id", "email", "name", "role"], "Login user object");

    assertType(data.token, "string", "token");
    assertType(data.user.email, "string", "user.email");
    assertType(data.user.name, "string", "user.name");
    assertType(data.user.role, "string", "user.role");

    // Ensure password or hash is never returned
    if (data.user.password || data.user.hash) {
      throw new Error("Contract violation: Password/hash returned in user object");
    }

    console.log(`  PASS: Login response adheres to contract: { user: { _id, email, name, role }, token }.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 2: Successful Transaction Response Matches Documented Schema
  // -------------------------------------------------------------
  console.log("TEST 2: Successful Transaction Response Matches Documented Schema");
  let tx1IdempotencyKey = `contract-tx1-${testSuffix}`;
  let tx1Data = null;

  try {
    const res = await fetch(`${BASE_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userToken}`
      },
      body: JSON.stringify({
        fromAccount: userAccount._id.toString(),
        toAccount: recipientAccount._id.toString(),
        amount: 2500,
        idempotencyKey: tx1IdempotencyKey
      })
    });

    if (res.status !== 201) {
      throw new Error(`Expected 201 Created, got ${res.status}`);
    }

    tx1Data = await res.json();
    assertFieldsPresent(tx1Data, ["message", "transaction"], "Transaction Response");
    assertType(tx1Data.message, "string", "message");

    const tx = tx1Data.transaction;
    assertFieldsPresent(tx, ["id", "fromAccount", "toAccount", "amount", "status", "idempotencyKey", "createdAt"], "Transaction object");
    assertType(tx.amount, "number", "transaction.amount");
    assertType(tx.status, "string", "transaction.status");

    if (tx.status !== "COMPLETED") {
      throw new Error(`Expected transaction.status to be COMPLETED, got ${tx.status}`);
    }

    console.log(`  PASS: Transaction created matching schema: { message: "${tx1Data.message}", transaction: { id: "${tx.id}", amount: ${tx.amount}, status: "${tx.status}" } }.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 3: Invalid Transaction Returns Documented Error Structure
  // -------------------------------------------------------------
  console.log("TEST 3: Invalid Transaction Returns Documented Error Contract");
  try {
    // Attempt invalid self-transfer
    const res = await fetch(`${BASE_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userToken}`
      },
      body: JSON.stringify({
        fromAccount: userAccount._id.toString(),
        toAccount: userAccount._id.toString(),
        amount: 1000,
        idempotencyKey: `contract-fail-self-${testSuffix}`
      })
    });

    if (res.status !== 400) {
      throw new Error(`Expected 400 Bad Request for self-transfer, got ${res.status}`);
    }

    const data = await res.json();
    assertFieldsPresent(data, ["message"], "Error Response");
    assertType(data.message, "string", "message");

    if (data.message !== "fromAccount and toAccount cannot be the same") {
      throw new Error(`Unexpected error message: "${data.message}"`);
    }

    console.log(`  PASS: Error matches standard contract: status 400 with { message: "${data.message}" }.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 4: Unauthorized Request Returns Documented 401 Structure
  // -------------------------------------------------------------
  console.log("TEST 4: Unauthorized Request Returns Documented 401 Structure");
  try {
    const res = await fetch(`${BASE_URL}/accounts`, {
      headers: { "Authorization": "Bearer invalid.token.signature" }
    });

    if (res.status !== 401) {
      throw new Error(`Expected 401 Unauthorized, got ${res.status}`);
    }

    const data = await res.json();
    assertFieldsPresent(data, ["message"], "401 Error Response");
    assertType(data.message, "string", "message");

    console.log(`  PASS: 401 Unauthorized returns standard error envelope: { message: "${data.message}" }.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 5: Normal USER Accessing Admin API Returns Documented 403 Structure
  // -------------------------------------------------------------
  console.log("TEST 5: Normal USER Accessing Admin API Returns Documented 403 Structure");
  try {
    const res = await fetch(`${BASE_URL}/admin/dashboard/stats`, {
      headers: { "Authorization": `Bearer ${userToken}` }
    });

    if (res.status !== 403) {
      throw new Error(`Expected 403 Forbidden, got ${res.status}`);
    }

    const data = await res.json();
    assertFieldsPresent(data, ["message"], "403 Forbidden Response");
    assertType(data.message, "string", "message");

    if (!data.message.toLowerCase().includes("admin")) {
      throw new Error(`Expected admin requirement message, got: "${data.message}"`);
    }

    console.log(`  PASS: 403 Forbidden returns standard contract: { message: "${data.message}" }.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 6: Idempotent Replay Returns Documented Response
  // -------------------------------------------------------------
  console.log("TEST 6: Idempotent Replay Returns Documented Response");
  try {
    const res = await fetch(`${BASE_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userToken}`
      },
      body: JSON.stringify({
        fromAccount: userAccount._id.toString(),
        toAccount: recipientAccount._id.toString(),
        amount: 2500,
        idempotencyKey: tx1IdempotencyKey
      })
    });

    if (res.status !== 200) {
      throw new Error(`Expected 200 OK for idempotent replay, got ${res.status}`);
    }

    const data = await res.json();
    assertFieldsPresent(data, ["message", "transaction"], "Idempotent Replay Response");
    assertType(data.message, "string", "message");

    if (data.message !== "Transaction already processed") {
      throw new Error(`Expected message "Transaction already processed", got "${data.message}"`);
    }

    if (data.transaction.idempotencyKey !== tx1IdempotencyKey) {
      throw new Error(`Idempotency key mismatch: ${data.transaction.idempotencyKey}`);
    }

    console.log(`  PASS: Idempotent replay returned 200 OK with cached transaction and message "${data.message}".\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 7: Risk-Blocked Transaction Returns Documented Response
  // -------------------------------------------------------------
  console.log("TEST 7: Risk-Blocked Transaction Returns Documented Response");
  try {
    // Create new recipient account so FIRST_TIME_BENEFICIARY triggers
    const newRecipient = await accountModel.create({
      user: recipientUser._id,
      currency: "INR",
      status: "ACTIVE"
    });

    // ₹60,000 transfer (VERY_HIGH_AMOUNT: 35 + FIRST_TIME: 20 + NEW_ACCOUNT: 10 = 65 -> MANUAL_REVIEW)
    const res = await fetch(`${BASE_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userToken}`
      },
      body: JSON.stringify({
        fromAccount: userAccount._id.toString(),
        toAccount: newRecipient._id.toString(),
        amount: 60000,
        idempotencyKey: `contract-blocked-tx-${testSuffix}`
      })
    });

    if (res.status !== 403) {
      throw new Error(`Expected 403 Forbidden for risk-blocked transfer, got ${res.status}`);
    }

    const data = await res.json();
    assertFieldsPresent(data, ["message"], "Risk-Blocked Response");
    assertType(data.message, "string", "message");

    console.log(`  PASS: Risk engine held/blocked transaction with 403 Forbidden and message: "${data.message}".\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 8: Admin Dashboard Response Matches Documented Fields
  // -------------------------------------------------------------
  console.log("TEST 8: Admin Dashboard Response Matches Documented Fields");
  try {
    const res = await fetch(`${BASE_URL}/admin/dashboard/stats`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });

    if (res.status !== 200) {
      throw new Error(`Expected 200 OK for admin dashboard stats, got ${res.status}`);
    }

    const stats = await res.json();
    const expectedFields = [
      "totalUsers",
      "totalTransactions",
      "completedTransactions",
      "failedTransactions",
      "flaggedTransactions",
      "manualReviewTransactions",
      "blockedTransactions",
      "totalTransactionVolume"
    ];

    assertFieldsPresent(stats, expectedFields, "Dashboard Stats Response");

    for (const f of expectedFields) {
      assertType(stats[f], "number", f);
    }

    console.log(`  PASS: Admin dashboard stats matches contract: ${JSON.stringify(stats).slice(0, 100)}...\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 9: Pagination Response Matches Documented Structure
  // -------------------------------------------------------------
  console.log("TEST 9: Pagination Response Matches Documented Structure");
  try {
    const res = await fetch(`${BASE_URL}/admin/transactions?page=1&limit=5`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });

    if (res.status !== 200) {
      throw new Error(`Expected 200 OK for paginated transactions, got ${res.status}`);
    }

    const data = await res.json();
    assertFieldsPresent(data, ["transactions", "pagination"], "Paginated Transactions Response");
    assertFieldsPresent(data.pagination, ["page", "limit", "total", "totalPages"], "Pagination object");

    if (!Array.isArray(data.transactions)) {
      throw new Error("Contract violation: transactions must be an array");
    }

    assertType(data.pagination.page, "number", "pagination.page");
    assertType(data.pagination.limit, "number", "pagination.limit");
    assertType(data.pagination.total, "number", "pagination.total");
    assertType(data.pagination.totalPages, "number", "pagination.totalPages");

    if (data.pagination.limit !== 5) {
      throw new Error(`Expected limit to be 5, got ${data.pagination.limit}`);
    }

    console.log(`  PASS: Pagination contract verified: page=${data.pagination.page}, limit=${data.pagination.limit}, total=${data.pagination.total}, totalPages=${data.pagination.totalPages}.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 10: Audit API Response Matches Documented Structure
  // -------------------------------------------------------------
  console.log("TEST 10: Audit API Response Matches Documented Structure");
  try {
    const res = await fetch(`${BASE_URL}/admin/audit-logs?page=1&limit=5`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });

    if (res.status !== 200) {
      throw new Error(`Expected 200 OK for audit logs query, got ${res.status}`);
    }

    const data = await res.json();
    assertFieldsPresent(data, ["auditLogs", "pagination"], "Audit Logs Response");
    assertFieldsPresent(data.pagination, ["page", "limit", "total", "totalPages"], "Pagination metadata");

    if (!Array.isArray(data.auditLogs)) {
      throw new Error("Contract violation: auditLogs must be an array");
    }

    if (data.auditLogs.length > 0) {
      const sample = data.auditLogs[0];
      assertFieldsPresent(sample, ["_id", "action", "resourceType", "createdAt"], "Audit log entry");
    }

    console.log(`  PASS: Audit API returned valid contract: ${data.auditLogs.length} audit logs with pagination metadata.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // Teardown
  await mongoose.disconnect();

  console.log("==========================================================");
  if (allPassed) {
    console.log("    ALL 10 API CONTRACT & SCHEMA TESTS PASSED (10/10)     ");
  } else {
    console.log("    SOME API CONTRACT TESTS FAILED. CHECK LOGS ABOVE.     ");
  }
  console.log("==========================================================");

  if (!allPassed) {
    process.exit(1);
  }
}

runApiContractTests().catch(err => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
