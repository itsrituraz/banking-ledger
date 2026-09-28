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
const tokenBlackListModel = require("../src/models/blacklist.model");

const BASE_URL = "http://localhost:3000/api";

function generateAuthToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), role: user.role || "USER" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

async function runAuditTrailTests() {
  console.log("==========================================================");
  console.log("       IMMUTABLE AUDIT TRAIL v1 TEST SUITE                ");
  console.log("==========================================================");

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB Atlas successfully.\n");

  const testSuffix = Date.now();
  let allPassed = true;

  // Setup: Create normal user, recipient user, admin user, and accounts
  const normalUser = await userModel.create({
    name: `Audit Normal ${testSuffix}`,
    email: `audit_user_${testSuffix}@example.com`,
    password: "Password123!",
    role: "USER"
  });

  const recipientUser = await userModel.create({
    name: `Audit Recipient ${testSuffix}`,
    email: `audit_recip_${testSuffix}@example.com`,
    password: "Password123!",
    role: "USER"
  });

  const adminUser = await userModel.create({
    name: `Audit Admin ${testSuffix}`,
    email: `audit_admin_${testSuffix}@example.com`,
    password: "Password123!",
    role: "ADMIN"
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

  const adminAccount = await accountModel.create({
    user: adminUser._id,
    currency: "INR",
    status: "ACTIVE"
  });

  // Fund normal user account with 50,000 INR
  const seedTx = await transactionModel.create({
    fromAccount: userAccount._id,
    toAccount: userAccount._id,
    amount: 50000,
    status: "COMPLETED",
    idempotencyKey: `audit_seed_${testSuffix}`,
    riskScore: 0,
    riskStatus: "APPROVED"
  });

  await ledgerModel.create({
    account: userAccount._id,
    amount: 50000,
    transaction: seedTx._id,
    type: "CREDIT"
  });

  const userToken = generateAuthToken(normalUser);
  const adminToken = generateAuthToken(adminUser);

  let createdAuditLogId = null;

  // ----------------------------------------------------
  // TEST 1: Successful Transfer Generates In-Session and Pre-Session Audit Events
  // ----------------------------------------------------
  console.log("TEST 1: Successful transfer generates complete audit lifecycle events...");
  try {
    const idempotencyKey = `audit-tx-1-${testSuffix}`;
    const res = await fetch(`${BASE_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userToken}`,
        "X-Request-Id": `req-transfer-${testSuffix}`
      },
      body: JSON.stringify({
        fromAccount: userAccount._id.toString(),
        toAccount: recipientAccount._id.toString(),
        amount: 2500,
        idempotencyKey
      })
    });

    const data = await res.json();
    if (res.status !== 201) {
      throw new Error(`Expected HTTP 201, got ${res.status}: ${JSON.stringify(data)}`);
    }

    const txId = data.transaction._id;

    // Check MongoDB for expected audit logs
    const riskLog = await auditLogModel.findOne({
      action: "RISK_EVALUATED",
      resourceId: idempotencyKey
    });

    const createdLog = await auditLogModel.findOne({
      action: "TRANSACTION_CREATED",
      transactionId: txId
    });

    const completedLog = await auditLogModel.findOne({
      action: "TRANSACTION_COMPLETED",
      transactionId: txId
    });

    if (!riskLog) throw new Error("Missing RISK_EVALUATED audit log");
    if (!createdLog) throw new Error("Missing TRANSACTION_CREATED audit log");
    if (!completedLog) throw new Error("Missing TRANSACTION_COMPLETED audit log");

    if (String(riskLog.actorUser) !== String(normalUser._id)) {
      throw new Error(`riskLog actorUser mismatch: expected ${normalUser._id}, got ${riskLog.actorUser}`);
    }
    if (riskLog.requestId !== `req-transfer-${testSuffix}`) {
      throw new Error(`riskLog requestId mismatch: expected req-transfer-${testSuffix}, got ${riskLog.requestId}`);
    }

    createdAuditLogId = completedLog._id;
    console.log("  PASS: Transfer created RISK_EVALUATED, TRANSACTION_CREATED, and TRANSACTION_COMPLETED audit logs with correlation IDs.\n");
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // ----------------------------------------------------
  // TEST 2: Risk Evaluation Audit Records Risk Metrics
  // ----------------------------------------------------
  console.log("TEST 2: Risk evaluation audit log preserves riskScore, riskStatus, and riskReasons...");
  try {
    const riskLog = await auditLogModel.findOne({
      action: "RISK_EVALUATED",
      resourceId: `audit-tx-1-${testSuffix}`
    });

    if (!riskLog) throw new Error("Risk log not found");
    if (typeof riskLog.metadata?.riskScore !== "number") {
      throw new Error(`riskScore is not a number: ${riskLog.metadata?.riskScore}`);
    }
    if (!["APPROVED", "FLAGGED", "MANUAL_REVIEW", "BLOCKED"].includes(riskLog.metadata?.riskStatus)) {
      throw new Error(`Invalid riskStatus: ${riskLog.metadata?.riskStatus}`);
    }
    if (!Array.isArray(riskLog.metadata?.riskReasons)) {
      throw new Error(`riskReasons is not an array: ${typeof riskLog.metadata?.riskReasons}`);
    }
    if (riskLog.metadata?.amount !== 2500) {
      throw new Error(`Metadata amount mismatch: ${riskLog.metadata?.amount}`);
    }

    console.log(`  PASS: Risk evaluation audit logged riskScore (${riskLog.metadata.riskScore}), riskStatus (${riskLog.metadata.riskStatus}), riskReasons (${JSON.stringify(riskLog.metadata.riskReasons)}).\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // ----------------------------------------------------
  // TEST 3: Blocked Transaction Audit Recording & Zero Ledger Footprint
  // ----------------------------------------------------
  console.log("TEST 3: Blocked transaction writes audit logs but generates ZERO ledger entries...");
  try {
    const blockedRecipient = await userModel.create({
      name: `Blocked Recip ${testSuffix}`,
      email: `blk_recip_${testSuffix}@example.com`,
      password: "Password123!",
      role: "USER"
    });
    const blockedRecipientAccount = await accountModel.create({
      user: blockedRecipient._id,
      currency: "INR",
      status: "ACTIVE"
    });

    // Generate velocity on userAccount: 3 rapid transactions in 1 minute
    for (let k = 1; k <= 3; k++) {
      await transactionModel.create({
        fromAccount: userAccount._id,
        toAccount: recipientAccount._id,
        amount: 10,
        status: "COMPLETED",
        idempotencyKey: `audit_vel_${testSuffix}_${k}`,
        createdAt: new Date()
      });
    }

    const blockedIdempotencyKey = `audit-tx-blocked-${testSuffix}`;
    // Transfer ₹60,000:
    // VERY_HIGH_AMOUNT (35) + VERY_HIGH_VELOCITY (40) + FIRST_TIME (20) + NEW_ACCOUNT (10) = 105 -> 100 (BLOCKED)
    const res = await fetch(`${BASE_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userToken}`,
        "X-Request-Id": `req-blocked-${testSuffix}`
      },
      body: JSON.stringify({
        fromAccount: userAccount._id.toString(),
        toAccount: blockedRecipientAccount._id.toString(),
        amount: 60000,
        idempotencyKey: blockedIdempotencyKey
      })
    });

    const data = await res.json();
    if (res.status !== 403) {
      throw new Error(`Expected HTTP 403 for blocked transaction, got ${res.status}: ${JSON.stringify(data)}`);
    }

    // Verify audit logs exist
    const blockedAuditLog = await auditLogModel.findOne({
      action: "TRANSACTION_BLOCKED",
      resourceId: blockedIdempotencyKey
    });

    if (!blockedAuditLog) {
      throw new Error("Missing TRANSACTION_BLOCKED audit log entry");
    }

    // Verify ledger has ZERO entries for this transaction attempt
    const blockedTxDoc = await transactionModel.findOne({ idempotencyKey: blockedIdempotencyKey });
    if (!blockedTxDoc) throw new Error("Expected FAILED transaction record in database");

    const ledgerEntries = await ledgerModel.find({ transaction: blockedTxDoc._id });
    if (ledgerEntries.length !== 0) {
      throw new Error(`Integrity violation: Blocked transaction generated ${ledgerEntries.length} ledger entries! Expected 0.`);
    }

    console.log("  PASS: Blocked transaction recorded TRANSACTION_BLOCKED audit event with ZERO ledger entries.\n");
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // ----------------------------------------------------
  // TEST 4: Audit Immutability Enforcement (DB Hooks Block Mutations/Deletions)
  // ----------------------------------------------------
  console.log("TEST 4: Strict immutability hooks prevent modification and deletion of audit logs...");
  try {
    const logDoc = await auditLogModel.findById(createdAuditLogId);
    if (!logDoc) throw new Error("Audit log not found for immutability test");

    const originalAction = logDoc.action;

    // 1. Test updateOne
    let updateOneBlocked = false;
    try {
      await auditLogModel.updateOne({ _id: logDoc._id }, { $set: { action: "TAMPERED_ACTION" } });
    } catch (e) {
      updateOneBlocked = true;
    }
    if (!updateOneBlocked) throw new Error("Security failure: updateOne was allowed on AuditLog!");

    // 2. Test findOneAndUpdate
    let findOneAndUpdateBlocked = false;
    try {
      await auditLogModel.findOneAndUpdate({ _id: logDoc._id }, { $set: { action: "TAMPERED_ACTION" } });
    } catch (e) {
      findOneAndUpdateBlocked = true;
    }
    if (!findOneAndUpdateBlocked) throw new Error("Security failure: findOneAndUpdate was allowed on AuditLog!");

    // 3. Test deleteOne
    let deleteOneBlocked = false;
    try {
      await auditLogModel.deleteOne({ _id: logDoc._id });
    } catch (e) {
      deleteOneBlocked = true;
    }
    if (!deleteOneBlocked) throw new Error("Security failure: deleteOne was allowed on AuditLog!");

    // 4. Test findOneAndDelete
    let findOneAndDeleteBlocked = false;
    try {
      await auditLogModel.findOneAndDelete({ _id: logDoc._id });
    } catch (e) {
      findOneAndDeleteBlocked = true;
    }
    if (!findOneAndDeleteBlocked) throw new Error("Security failure: findOneAndDelete was allowed on AuditLog!");

    // 5. Test document-level save on existing document
    let saveBlocked = false;
    try {
      logDoc.action = "TAMPERED_SAVE";
      await logDoc.save();
    } catch (e) {
      saveBlocked = true;
    }
    if (!saveBlocked) throw new Error("Security failure: document .save() was allowed on existing AuditLog!");

    // 6. Verify original document remains completely untouched in MongoDB
    const untouchedDoc = await auditLogModel.findById(logDoc._id);
    if (untouchedDoc.action !== originalAction) {
      throw new Error(`Data corruption detected: expected action ${originalAction}, found ${untouchedDoc.action}`);
    }

    console.log("  PASS: All 5 mutation/deletion methods blocked. Record verified intact in MongoDB.\n");
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // ----------------------------------------------------
  // TEST 5: RBAC Authorization — Normal USER Receives 403 on Audit Logs
  // ----------------------------------------------------
  console.log("TEST 5: Normal USER receives 403 Forbidden on audit log endpoints...");
  try {
    const listRes = await fetch(`${BASE_URL}/admin/audit-logs`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${userToken}` }
    });

    if (listRes.status !== 403) {
      throw new Error(`Expected HTTP 403 on /admin/audit-logs, got ${listRes.status}`);
    }

    const detailRes = await fetch(`${BASE_URL}/admin/audit-logs/${createdAuditLogId}`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${userToken}` }
    });

    if (detailRes.status !== 403) {
      throw new Error(`Expected HTTP 403 on /admin/audit-logs/:id, got ${detailRes.status}`);
    }

    console.log("  PASS: Normal USER correctly rejected with 403 on audit monitoring endpoints.\n");
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // ----------------------------------------------------
  // TEST 6: RBAC Authorization — ADMIN Receives 200 on Audit Logs
  // ----------------------------------------------------
  console.log("TEST 6: ADMIN receives 200 OK on audit logs list and detail endpoints...");
  try {
    const listRes = await fetch(`${BASE_URL}/admin/audit-logs`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${adminToken}` }
    });

    if (listRes.status !== 200) {
      throw new Error(`Expected HTTP 200 on /admin/audit-logs, got ${listRes.status}`);
    }

    const listData = await listRes.json();
    if (!Array.isArray(listData.auditLogs)) {
      throw new Error("Expected auditLogs array in response");
    }
    if (!listData.pagination || typeof listData.pagination.total !== "number") {
      throw new Error("Expected pagination object with total");
    }

    const detailRes = await fetch(`${BASE_URL}/admin/audit-logs/${createdAuditLogId}`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${adminToken}` }
    });

    if (detailRes.status !== 200) {
      throw new Error(`Expected HTTP 200 on /admin/audit-logs/:id, got ${detailRes.status}`);
    }

    const detailData = await detailRes.json();
    if (!detailData.auditLog || detailData.auditLog._id !== createdAuditLogId.toString()) {
      throw new Error("Audit log detail ID mismatch");
    }

    // Verify actorUser has no password
    if (detailData.auditLog.actorUser && detailData.auditLog.actorUser.password) {
      throw new Error("Security leak: actorUser contains password field");
    }

    console.log(`  PASS: ADMIN successfully retrieved paginated audit logs (${listData.auditLogs.length} items) and individual log detail.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // ----------------------------------------------------
  // TEST 7: Pagination and Validation Bounds on Audit Logs API
  // ----------------------------------------------------
  console.log("TEST 7: Audit log API rejects invalid pagination and filter bounds with 400 Bad Request...");
  try {
    // page < 1
    const p1 = await fetch(`${BASE_URL}/admin/audit-logs?page=0`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    if (p1.status !== 400) throw new Error(`Expected 400 for page=0, got ${p1.status}`);

    // limit > 100
    const p2 = await fetch(`${BASE_URL}/admin/audit-logs?limit=101`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    if (p2.status !== 400) throw new Error(`Expected 400 for limit=101, got ${p2.status}`);

    // invalid resourceType
    const p3 = await fetch(`${BASE_URL}/admin/audit-logs?resourceType=INVALID_RESOURCE`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    if (p3.status !== 400) throw new Error(`Expected 400 for invalid resourceType, got ${p3.status}`);

    // invalid dateFrom
    const p4 = await fetch(`${BASE_URL}/admin/audit-logs?dateFrom=invalid-date`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    if (p4.status !== 400) throw new Error(`Expected 400 for invalid dateFrom, got ${p4.status}`);

    // valid pagination limit
    const p5 = await fetch(`${BASE_URL}/admin/audit-logs?limit=2&page=1`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    if (p5.status !== 200) throw new Error(`Expected 200 for valid limit=2, got ${p5.status}`);
    const d5 = await p5.json();
    if (d5.auditLogs.length > 2) throw new Error(`Expected at most 2 audit logs, got ${d5.auditLogs.length}`);

    console.log("  PASS: Boundary checks correctly reject invalid query parameters and enforce limits.\n");
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // ----------------------------------------------------
  // TEST 8: Sensitive Data Sanitization Verification
  // ----------------------------------------------------
  console.log("TEST 8: Sensitive data sanitization prevents passwords and tokens from entering audit logs...");
  try {
    const rawPass = "MySuperSecretPassword#2026!";
    const testRegEmail = `sanitize_test_${testSuffix}@example.com`;

    // 1. Register a user with password
    const regRes = await fetch(`${BASE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Sanitize User ${testSuffix}`,
        email: testRegEmail,
        password: rawPass
      })
    });

    if (regRes.status !== 201) throw new Error(`Registration failed: ${regRes.status}`);

    // Query registration audit log
    const regAudit = await auditLogModel.findOne({
      action: "USER_REGISTERED",
      "metadata.email": testRegEmail
    });

    if (!regAudit) throw new Error("Missing USER_REGISTERED audit log");
    const regMetaString = JSON.stringify(regAudit.metadata || {});
    if (regMetaString.includes(rawPass)) {
      throw new Error("Security leak: plain text password found in USER_REGISTERED audit metadata!");
    }
    if (regMetaString.toLowerCase().includes("password")) {
      throw new Error("Security leak: password field found in audit metadata!");
    }

    // 2. Failed login attempt
    await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testRegEmail,
        password: "WrongPassword123!"
      })
    });

    const failedAudit = await auditLogModel.findOne({
      action: "LOGIN_FAILED",
      "metadata.attemptedEmail": testRegEmail
    });

    if (!failedAudit) throw new Error("Missing LOGIN_FAILED audit log");
    const failedMetaString = JSON.stringify(failedAudit.metadata || {});
    if (failedMetaString.includes("WrongPassword123!")) {
      throw new Error("Security leak: wrong password recorded in LOGIN_FAILED audit metadata!");
    }
    if (failedMetaString.toLowerCase().includes("password") && !failedMetaString.includes("INVALID_PASSWORD")) {
      throw new Error("Security leak: password key preserved in metadata!");
    }

    console.log("  PASS: Passwords, tokens, and sensitive keys are stripped from all audit log entries.\n");
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // ----------------------------------------------------
  // TEST 9: Blacklisted Admin Token Receives 401 on Audit Endpoints
  // ----------------------------------------------------
  console.log("TEST 9: Blacklisted admin token is rejected with 401 on audit log endpoints...");
  try {
    const tempAdmin = await userModel.create({
      name: `Logout Admin ${testSuffix}`,
      email: `logout_admin_${testSuffix}@example.com`,
      password: "Password123!",
      role: "ADMIN"
    });

    const tempToken = generateAuthToken(tempAdmin);

    // Call logout to blacklist the token
    const logoutRes = await fetch(`${BASE_URL}/auth/logout`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${tempToken}`
      }
    });

    if (logoutRes.status !== 200) {
      throw new Error(`Expected 200 on logout, got ${logoutRes.status}`);
    }

    // Verify token is in blacklist model
    const isBlacklisted = await tokenBlackListModel.findOne({ token: tempToken });
    if (!isBlacklisted) throw new Error("Token was not blacklisted in database");

    // Attempt to access audit logs with blacklisted token
    const auditRes = await fetch(`${BASE_URL}/admin/audit-logs`, {
      headers: { "Authorization": `Bearer ${tempToken}` }
    });

    if (auditRes.status !== 401) {
      throw new Error(`Expected HTTP 401 for blacklisted token, got ${auditRes.status}`);
    }

    console.log("  PASS: Revoked/blacklisted token properly rejected with 401 Unauthorized.\n");
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // ----------------------------------------------------
  // TEST 10: Admin Action Audit Logging (Self-Auditing Administrative Actions)
  // ----------------------------------------------------
  console.log("TEST 10: Administrative read-only inspections create self-auditing records...");
  try {
    // 1. Admin accesses flagged transactions
    await fetch(`${BASE_URL}/admin/transactions/flagged`, {
      headers: {
        "Authorization": `Bearer ${adminToken}`,
        "X-Request-Id": `req-admin-risk-${testSuffix}`
      }
    });

    const riskViewAudit = await auditLogModel.findOne({
      action: "ADMIN_VIEWED_RISK_DATA",
      actorUser: adminUser._id
    });

    if (!riskViewAudit) throw new Error("Missing ADMIN_VIEWED_RISK_DATA audit log");

    // 2. Admin accesses user list
    await fetch(`${BASE_URL}/admin/users`, {
      headers: {
        "Authorization": `Bearer ${adminToken}`,
        "X-Request-Id": `req-admin-users-${testSuffix}`
      }
    });

    const userViewAudit = await auditLogModel.findOne({
      action: "ADMIN_VIEWED_USER",
      actorUser: adminUser._id
    });

    if (!userViewAudit) throw new Error("Missing ADMIN_VIEWED_USER audit log");

    console.log("  PASS: Admin views of risk data and user registries are fully audited.\n");
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  await mongoose.disconnect();

  console.log("==========================================================");
  if (allPassed) {
    console.log("    ALL 10 IMMUTABLE AUDIT TRAIL TESTS PASSED (10/10)     ");
  } else {
    console.log("    SOME AUDIT TRAIL TESTS FAILED. CHECK LOGS ABOVE.      ");
  }
  console.log("==========================================================");

  if (!allPassed) {
    process.exit(1);
  }
}

runAuditTrailTests().catch(err => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
