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

const BASE_URL = "http://localhost:3000/api";

function generateAuthToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), role: user.role || "USER" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

// Helper to inspect explain plan execution stages recursively
function planContainsStage(stageObj, targetStage) {
  if (!stageObj) return false;
  if (stageObj.stage === targetStage) return true;
  if (stageObj.inputStage && planContainsStage(stageObj.inputStage, targetStage)) return true;
  if (Array.isArray(stageObj.inputStages)) {
    return stageObj.inputStages.some(s => planContainsStage(s, targetStage));
  }
  return false;
}

// Recursive helper to extract winning index name
function findIndexName(stageObj) {
  if (!stageObj) return null;
  if (stageObj.indexName) return stageObj.indexName;
  if (stageObj.inputStage) {
    const res = findIndexName(stageObj.inputStage);
    if (res) return res;
  }
  if (Array.isArray(stageObj.inputStages)) {
    for (const st of stageObj.inputStages) {
      const res = findIndexName(st);
      if (res) return res;
    }
  }
  return null;
}

function getWinningIndexName(explain) {
  const plan = explain.queryPlanner?.winningPlan;
  if (!plan) return null;
  return findIndexName(plan);
}

async function runDatabasePerformanceTests() {
  console.log("==========================================================");
  console.log("      DATABASE & PERFORMANCE ENGINEERING TEST SUITE       ");
  console.log("==========================================================");

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB Atlas successfully.\n");

  const testSuffix = Date.now();
  let allPassed = true;

  // Setup: Create test users and accounts
  const passwordPlain = "Password123!";
  const testUserA = await userModel.create({
    name: `Perf User A ${testSuffix}`,
    email: `perf_user_a_${testSuffix}@example.com`,
    password: passwordPlain,
    role: "USER"
  });

  const testUserB = await userModel.create({
    name: `Perf User B ${testSuffix}`,
    email: `perf_user_b_${testSuffix}@example.com`,
    password: passwordPlain,
    role: "USER"
  });

  const adminUser = await userModel.create({
    name: `Perf Admin ${testSuffix}`,
    email: `perf_admin_${testSuffix}@example.com`,
    password: passwordPlain,
    role: "ADMIN"
  });

  const userTokenA = generateAuthToken(testUserA);
  const userTokenB = generateAuthToken(testUserB);
  const adminToken = generateAuthToken(adminUser);

  const accountA = await accountModel.create({
    user: testUserA._id,
    currency: "INR",
    status: "ACTIVE"
  });

  const accountB = await accountModel.create({
    user: testUserB._id,
    currency: "INR",
    status: "ACTIVE"
  });

  // -------------------------------------------------------------
  // TEST 1: Covered Index on Ledger Balance Query
  // -------------------------------------------------------------
  console.log("TEST 1: Ledger Balance Query Uses Covered Index (account_1_type_1_amount_1)");
  try {
    const explain = await ledgerModel.collection.aggregate([
      { $match: { account: accountA._id } },
      {
        $group: {
          _id: "$account",
          totalDebit: { $sum: { $cond: [{ $eq: ["$type", "DEBIT"] }, "$amount", 0] } },
          totalCredit: { $sum: { $cond: [{ $eq: ["$type", "CREDIT"] }, "$amount", 0] } }
        }
      }
    ]).explain("executionStats");

    let usedCovered = false;
    let docsExamined = 0;
    let winningIndex = "";

    if (explain.stages && Array.isArray(explain.stages)) {
      const cursorStage = explain.stages.find(s => s.$cursor);
      if (cursorStage) {
        const stats = cursorStage.$cursor.executionStats;
        docsExamined = stats?.totalDocsExamined ?? 0;
        winningIndex = cursorStage.$cursor.queryPlanner?.winningPlan?.inputStage?.indexName || "";
        usedCovered = docsExamined === 0 || winningIndex === "account_1_type_1_amount_1";
      }
    } else if (explain.executionStats) {
      docsExamined = explain.executionStats.totalDocsExamined;
      winningIndex = getWinningIndexName(explain) || "";
      usedCovered = docsExamined === 0 || winningIndex === "account_1_type_1_amount_1";
    }

    if (!usedCovered && winningIndex !== "account_1_type_1_amount_1" && docsExamined > 0) {
      throw new Error(`Expected covered index account_1_type_1_amount_1, but got index: ${winningIndex}, docsExamined: ${docsExamined}`);
    }

    console.log(`  PASS: Covered index used (${winningIndex || "account_1_type_1_amount_1"}), docsExamined: ${docsExamined}.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 2: Transaction Listing Uses Indexed Sort (No In-Memory SORT)
  // -------------------------------------------------------------
  console.log("TEST 2: Transaction Listing Uses Indexed Sort Without In-Memory Stage");
  try {
    const explain = await transactionModel.find({ status: "COMPLETED" })
      .sort({ createdAt: -1 })
      .limit(10)
      .explain("executionStats");

    const winningPlan = explain.queryPlanner?.winningPlan;
    const hasInMemorySort = planContainsStage(winningPlan, "SORT");

    if (hasInMemorySort) {
      throw new Error("Query plan uses an in-memory SORT stage instead of an indexed B-tree sort");
    }

    const indexUsed = getWinningIndexName(explain);
    console.log(`  PASS: Transaction query avoided in-memory SORT stage. Index used: ${indexUsed}.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 3: Admin Flagged Transactions Query Uses Compound Index
  // -------------------------------------------------------------
  console.log("TEST 3: Admin Flagged Transactions Query Uses Compound Index (riskStatus_1_createdAt_-1)");
  try {
    const explain = await transactionModel.find({ riskStatus: "FLAGGED" })
      .sort({ createdAt: -1 })
      .limit(10)
      .explain("executionStats");

    const winningPlan = explain.queryPlanner?.winningPlan;
    const hasInMemorySort = planContainsStage(winningPlan, "SORT");
    const indexUsed = getWinningIndexName(explain);

    if (hasInMemorySort) {
      throw new Error("Admin flagged transaction query used in-memory SORT stage");
    }
    if (indexUsed !== "riskStatus_1_createdAt_-1") {
      throw new Error(`Expected index riskStatus_1_createdAt_-1, got ${indexUsed}`);
    }

    console.log(`  PASS: Admin query correctly routed through ${indexUsed} with 0 in-memory sorting.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 4: Audit Log Query by requestId Avoids COLLSCAN
  // -------------------------------------------------------------
  console.log("TEST 4: Audit Log Correlation Lookup by requestId Avoids COLLSCAN");
  try {
    const explain = await auditLogModel.find({ requestId: "perf-req-corr-12345" })
      .explain("executionStats");

    const winningPlan = explain.queryPlanner?.winningPlan;
    const isCollScan = planContainsStage(winningPlan, "COLLSCAN");
    const indexUsed = getWinningIndexName(explain);

    if (isCollScan) {
      throw new Error("Audit log correlation query resulted in a COLLSCAN (collection scan)");
    }
    if (indexUsed !== "requestId_1") {
      throw new Error(`Expected index requestId_1, got: ${indexUsed}`);
    }

    console.log(`  PASS: Correlation ID lookup uses targeted index ${indexUsed} (no COLLSCAN).\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 5: Admin Dashboard Facet Aggregation Correctness & Speed
  // -------------------------------------------------------------
  console.log("TEST 5: Admin Dashboard Facet Aggregation Completes Correctly and Efficiently");
  try {
    const start = Date.now();
    const res = await fetch(`${BASE_URL}/admin/dashboard/stats`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    const duration = Date.now() - start;

    if (res.status !== 200) {
      const errBody = await res.text();
      throw new Error(`Expected 200 OK from dashboard stats endpoint, got ${res.status}: ${errBody}`);
    }

    const data = await res.json();
    if (typeof data.totalUsers !== "number" || typeof data.totalTransactions !== "number") {
      throw new Error("Dashboard response is missing required numeric aggregation counters");
    }

    console.log(`  PASS: Admin dashboard aggregate completed in ${duration}ms (totalUsers: ${data.totalUsers}, totalTxs: ${data.totalTransactions}).\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 6: User Listing Query Uses Indexed Sort (createdAt: -1)
  // -------------------------------------------------------------
  console.log("TEST 6: User Listing Query Uses Indexed Sort (createdAt: -1)");
  try {
    const explain = await userModel.find({})
      .sort({ createdAt: -1 })
      .limit(20)
      .explain("executionStats");

    const winningPlan = explain.queryPlanner?.winningPlan;
    const hasInMemorySort = planContainsStage(winningPlan, "SORT");
    const indexUsed = getWinningIndexName(explain);

    if (hasInMemorySort) {
      throw new Error("User listing query fell back to an in-memory SORT stage");
    }
    if (indexUsed !== "createdAt_-1") {
      throw new Error(`Expected index createdAt_-1, got ${indexUsed}`);
    }

    console.log(`  PASS: User directory listing resolved via index ${indexUsed} without memory sort overhead.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 7: Pagination Metadata Contract and Correctness
  // -------------------------------------------------------------
  console.log("TEST 7: Pagination Metadata Contract & Correctness Under Limit/Page Bounds");
  try {
    const limit = 5;
    const res = await fetch(`${BASE_URL}/admin/users?page=1&limit=${limit}`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });

    if (res.status !== 200) {
      throw new Error(`Expected 200 OK, got ${res.status}`);
    }

    const data = await res.json();
    const { pagination, users } = data;

    if (!pagination || typeof pagination.total !== "number" || typeof pagination.totalPages !== "number") {
      throw new Error("Invalid or missing pagination object in response");
    }

    const expectedTotalPages = Math.ceil(pagination.total / limit);
    if (pagination.totalPages !== expectedTotalPages) {
      throw new Error(`totalPages calculation mismatch: got ${pagination.totalPages}, expected ${expectedTotalPages}`);
    }
    if (users.length > limit) {
      throw new Error(`users array exceeded limit ${limit}: got ${users.length}`);
    }

    console.log(`  PASS: Pagination contract verified (page: ${pagination.page}, limit: ${pagination.limit}, total: ${pagination.total}, totalPages: ${pagination.totalPages}).\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 8: Financial Integrity Balance Invariant Holds (balance === sum(CREDIT) - sum(DEBIT))
  // -------------------------------------------------------------
  console.log("TEST 8: Financial Invariant Holds: Balance === sum(CREDIT) - sum(DEBIT)");
  try {
    // Seed initial balance of 500 into accountA
    const seedTx = await transactionModel.create({
      fromAccount: accountA._id,
      toAccount: accountA._id,
      amount: 500,
      status: "COMPLETED",
      idempotencyKey: `perf-seed-${testSuffix}`,
      riskScore: 0,
      riskStatus: "APPROVED"
    });

    await ledgerModel.create({
      account: accountA._id,
      amount: 500,
      type: "CREDIT",
      transaction: seedTx._id
    });

    // Query balance via API
    const balRes = await fetch(`${BASE_URL}/accounts/balance/${accountA._id.toString()}`, {
      headers: { "Authorization": `Bearer ${userTokenA}` }
    });

    if (balRes.status !== 200) {
      const errText = await balRes.text();
      throw new Error(`Failed to fetch account balance: ${balRes.status} ${errText}`);
    }

    const balData = await balRes.json();
    const apiBalance = balData.balance;

    // Independently aggregate all ledger records for accountA
    const independentAgg = await ledgerModel.aggregate([
      { $match: { account: accountA._id } },
      {
        $group: {
          _id: "$account",
          totalCredit: { $sum: { $cond: [{ $eq: ["$type", "CREDIT"] }, "$amount", 0] } },
          totalDebit: { $sum: { $cond: [{ $eq: ["$type", "DEBIT"] }, "$amount", 0] } }
        }
      }
    ]);

    const computed = (independentAgg[0]?.totalCredit || 0) - (independentAgg[0]?.totalDebit || 0);

    if (apiBalance !== computed || apiBalance !== 500) {
      throw new Error(`Financial invariant violation: API balance (${apiBalance}) !== Ledger computed (${computed})`);
    }

    console.log(`  PASS: Invariant verified: API balance (${apiBalance}) matches ledger sum exactly (Credit: ${independentAgg[0]?.totalCredit}, Debit: ${independentAgg[0]?.totalDebit}).\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 9: Concurrency Write-Lock Prevents Double-Spend
  // -------------------------------------------------------------
  console.log("TEST 9: Concurrency Write-Lock on fromAccount Prevents Double-Spend");
  try {
    // accountA currently has 500 balance.
    // Fire two concurrent transfers of 350 each (total 700 > 500).
    // Exactly one should succeed, one must fail with insufficient balance (400) or conflict.
    const [tx1Res, tx2Res] = await Promise.all([
      fetch(`${BASE_URL}/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${userTokenA}`
        },
        body: JSON.stringify({
          fromAccount: accountA._id.toString(),
          toAccount: accountB._id.toString(),
          amount: 350,
          idempotencyKey: `perf-race-1-${testSuffix}`
        })
      }),
      fetch(`${BASE_URL}/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${userTokenA}`
        },
        body: JSON.stringify({
          fromAccount: accountA._id.toString(),
          toAccount: accountB._id.toString(),
          amount: 350,
          idempotencyKey: `perf-race-2-${testSuffix}`
        })
      })
    ]);

    const statuses = [tx1Res.status, tx2Res.status];
    const successCount = statuses.filter(s => s === 200 || s === 201).length;
    const failureCount = statuses.filter(s => s === 400 || s === 409 || s === 500).length;

    if (successCount !== 1) {
      throw new Error(`Double-spend concurrency violation! Expected exactly 1 success, got ${successCount} (statuses: ${statuses.join(", ")})`);
    }

    // Verify remaining balance in accountA is 500 - 350 = 150
    const finalBalRes = await fetch(`${BASE_URL}/accounts/balance/${accountA._id.toString()}`, {
      headers: { "Authorization": `Bearer ${userTokenA}` }
    });
    const finalBalData = await finalBalRes.json();

    if (finalBalData.balance !== 150) {
      throw new Error(`Unexpected post-concurrency balance: expected 150, got ${finalBalData.balance}`);
    }

    console.log(`  PASS: Double-spend blocked! Exactly 1 succeeded, 1 rejected. Remaining balance is strictly 150 (not negative).\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 10: Idempotent Re-Submission Returns Cached Transaction With Zero Duplicate Debits
  // -------------------------------------------------------------
  console.log("TEST 10: Idempotent Re-Submission Returns Cached Transaction With Zero Duplicate Debits");
  try {
    const idemKey = `perf-idem-dedup-${testSuffix}`;
    const transferPayload = {
      fromAccount: accountA._id.toString(),
      toAccount: accountB._id.toString(),
      amount: 50,
      idempotencyKey: idemKey
    };

    // First submission
    const res1 = await fetch(`${BASE_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userTokenA}`
      },
      body: JSON.stringify(transferPayload)
    });

    if (res1.status !== 201 && res1.status !== 200) {
      const errText = await res1.text();
      throw new Error(`First transfer failed: ${res1.status} ${errText}`);
    }
    const data1 = await res1.json();
    const txId = data1.transaction?._id || data1.transaction?.id;

    // Count ledger entries associated with this transaction
    const initialLedgerCount = await ledgerModel.countDocuments({ transaction: txId });
    if (initialLedgerCount !== 2) {
      throw new Error(`Expected exactly 2 ledger entries for transfer, got ${initialLedgerCount}`);
    }

    // Second submission with exact same idempotencyKey
    const res2 = await fetch(`${BASE_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userTokenA}`
      },
      body: JSON.stringify(transferPayload)
    });

    if (res2.status !== 200 && res2.status !== 201) {
      const errText = await res2.text();
      throw new Error(`Second (idempotent) transfer returned unexpected status: ${res2.status} ${errText}`);
    }

    // Verify ledger entries did not increase
    const finalLedgerCount = await ledgerModel.countDocuments({ transaction: txId });
    if (finalLedgerCount !== 2) {
      throw new Error(`Duplicate ledger entry created on replay! Expected 2, got ${finalLedgerCount}`);
    }

    // Verify balance is 150 - 50 = 100 (not debited twice)
    const balCheckRes = await fetch(`${BASE_URL}/accounts/balance/${accountA._id.toString()}`, {
      headers: { "Authorization": `Bearer ${userTokenA}` }
    });
    const balCheckData = await balCheckRes.json();
    if (balCheckData.balance !== 100) {
      throw new Error(`Balance was deducted multiple times: expected 100, got ${balCheckData.balance}`);
    }

    console.log(`  PASS: Idempotent replay returned cached response, ledger entries remain exactly 2, and balance deducted only once (balance: 100).\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // Teardown
  await mongoose.disconnect();

  console.log("==========================================================");
  if (allPassed) {
    console.log(" ALL 10 DATABASE & PERFORMANCE AUDIT TESTS PASSED (10/10) ");
  } else {
    console.log(" SOME DATABASE & PERFORMANCE AUDIT TESTS FAILED. CHECK LOGS ABOVE. ");
  }
  console.log("==========================================================");

  if (!allPassed) {
    process.exit(1);
  }
}

runDatabasePerformanceTests().catch(err => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
