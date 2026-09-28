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

async function runAdminMonitoringTests() {
  console.log("==========================================================");
  console.log("       ADMIN READ-ONLY MONITORING APIS TEST SUITE         ");
  console.log("==========================================================");

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB Atlas successfully.\n");

  const testSuffix = Date.now();
  let allPassed = true;

  // Setup: Create normal user, admin user, and accounts
  const normalUser = await userModel.create({
    name: `User Mon ${testSuffix}`,
    email: `user_mon_${testSuffix}@example.com`,
    password: "Password123!",
    role: "USER"
  });

  const adminUser = await userModel.create({
    name: `Admin Mon ${testSuffix}`,
    email: `admin_mon_${testSuffix}@example.com`,
    password: "Password123!",
    role: "ADMIN"
  });

  const userAccount = await accountModel.create({
    user: normalUser._id,
    currency: "INR",
    status: "ACTIVE"
  });

  const adminAccount = await accountModel.create({
    user: adminUser._id,
    currency: "INR",
    status: "ACTIVE"
  });

  // Seed sample transactions: 1 completed, 1 flagged, 1 blocked
  const sampleTxCompleted = await transactionModel.create({
    fromAccount: userAccount._id,
    toAccount: adminAccount._id,
    amount: 1500,
    status: "COMPLETED",
    idempotencyKey: `mon_comp_${testSuffix}`,
    riskScore: 20,
    riskStatus: "APPROVED",
    riskReasons: ["FIRST_TIME_BENEFICIARY"],
    clientIp: "127.0.0.1",
    userAgent: "AdminMonitoringTest/1.0"
  });

  await ledgerModel.create([
    {
      account: userAccount._id,
      amount: 1500,
      transaction: sampleTxCompleted._id,
      type: "DEBIT"
    },
    {
      account: adminAccount._id,
      amount: 1500,
      transaction: sampleTxCompleted._id,
      type: "CREDIT"
    }
  ]);

  const sampleTxFlagged = await transactionModel.create({
    fromAccount: userAccount._id,
    toAccount: adminAccount._id,
    amount: 12000,
    status: "COMPLETED",
    idempotencyKey: `mon_flag_${testSuffix}`,
    riskScore: 40,
    riskStatus: "FLAGGED",
    riskReasons: ["HIGH_TRANSACTION_AMOUNT", "FIRST_TIME_BENEFICIARY"],
    clientIp: "127.0.0.1",
    userAgent: "AdminMonitoringTest/1.0"
  });

  const sampleTxBlocked = await transactionModel.create({
    fromAccount: userAccount._id,
    toAccount: adminAccount._id,
    amount: 80000,
    status: "FAILED",
    idempotencyKey: `mon_blk_${testSuffix}`,
    riskScore: 95,
    riskStatus: "BLOCKED",
    riskReasons: ["VERY_HIGH_TRANSACTION_AMOUNT", "VERY_HIGH_TRANSACTION_VELOCITY", "FIRST_TIME_BENEFICIARY"],
    clientIp: "127.0.0.1",
    userAgent: "AdminMonitoringTest/1.0"
  });

  const normalToken = generateAuthToken(normalUser);
  const adminToken = generateAuthToken(adminUser);

  console.log("Setup complete with normal user, admin user, and sample transactions.\n");

  // -------------------------------------------------------------
  // TEST 1 — USER -> GET /api/admin/dashboard/stats
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 1: USER -> GET /api/admin/dashboard/stats ---");
    const res = await fetch(`${BASE_URL}/admin/dashboard/stats`, {
      headers: { "Authorization": `Bearer ${normalToken}` }
    });
    const data = await res.json();
    console.log(`HTTP Status: ${res.status}, Response:`, JSON.stringify(data));

    if (res.status === 403 && data.message === "Forbidden: Admin access required") {
      console.log("✓ TEST 1 PASSED: Normal user forbidden from dashboard stats\n");
    } else {
      throw new Error(`Expected 403, got ${res.status}`);
    }
  } catch (err) {
    console.error("✗ TEST 1 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 2 — ADMIN -> GET /api/admin/dashboard/stats
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 2: ADMIN -> GET /api/admin/dashboard/stats ---");
    const res = await fetch(`${BASE_URL}/admin/dashboard/stats`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    const data = await res.json();
    console.log(`HTTP Status: ${res.status}, Stats:`, JSON.stringify(data, null, 2));

    const requiredKeys = [
      "totalUsers",
      "totalTransactions",
      "completedTransactions",
      "failedTransactions",
      "flaggedTransactions",
      "manualReviewTransactions",
      "blockedTransactions",
      "totalTransactionVolume"
    ];

    const hasAllKeys = requiredKeys.every(k => data[k] !== undefined && typeof data[k] === "number");
    if (res.status === 200 && hasAllKeys) {
      console.log("✓ TEST 2 PASSED: Admin retrieved accurate aggregate dashboard statistics\n");
    } else {
      throw new Error(`Missing or non-numeric keys in stats response: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    console.error("✗ TEST 2 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 3 — ADMIN -> transaction list with pagination & filters
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 3: ADMIN -> GET /api/admin/transactions ---");
    const res = await fetch(`${BASE_URL}/admin/transactions?page=1&limit=5&status=COMPLETED`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    const data = await res.json();
    console.log(`HTTP Status: ${res.status}`);
    console.log(`Pagination:`, JSON.stringify(data.pagination));
    console.log(`Transactions returned: ${data.transactions?.length}`);

    if (
      res.status === 200 &&
      Array.isArray(data.transactions) &&
      data.pagination?.page === 1 &&
      data.pagination?.limit === 5 &&
      data.pagination?.total >= 1
    ) {
      console.log("✓ TEST 3 PASSED: Paginated and filtered transaction list returned successfully\n");
    } else {
      throw new Error(`Invalid transaction list structure: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    console.error("✗ TEST 3 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 4 — ADMIN -> flagged transactions (riskScore/reasons available)
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 4: ADMIN -> GET /api/admin/transactions/flagged ---");
    const res = await fetch(`${BASE_URL}/admin/transactions/flagged?page=1&limit=10`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    const data = await res.json();
    console.log(`HTTP Status: ${res.status}`);
    console.log(`Flagged count: ${data.transactions?.length}`);

    const hasElevatedStatus = data.transactions.every(tx =>
      ["FLAGGED", "MANUAL_REVIEW", "BLOCKED"].includes(tx.riskStatus)
    );

    const firstTx = data.transactions[0];
    const hasRiskDetails =
      firstTx &&
      firstTx.riskScore !== undefined &&
      Array.isArray(firstTx.riskReasons);

    console.log(`Sample Flagged Tx: riskStatus=${firstTx?.riskStatus}, riskScore=${firstTx?.riskScore}, reasons=${firstTx?.riskReasons?.join(",")}`);

    if (res.status === 200 && hasElevatedStatus && hasRiskDetails) {
      console.log("✓ TEST 4 PASSED: Elevated risk transactions retrieved with score and reasons visible to admin\n");
    } else {
      throw new Error(`Flagged transactions verification failed: hasElevated=${hasElevatedStatus}, hasRisk=${hasRiskDetails}`);
    }
  } catch (err) {
    console.error("✗ TEST 4 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 5 — ADMIN -> individual transaction details with ledger entries
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 5: ADMIN -> GET /api/admin/transactions/:id ---");
    const res = await fetch(`${BASE_URL}/admin/transactions/${sampleTxCompleted._id}`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    const data = await res.json();
    console.log(`HTTP Status: ${res.status}`);
    console.log(`Transaction ID: ${data.transaction?.id}`);
    console.log(`Ledger entries count: ${data.transaction?.ledgerEntries?.length}`);
    console.log(`Sender User:`, data.transaction?.fromAccount?.user?.email);

    if (
      res.status === 200 &&
      data.transaction?.id === sampleTxCompleted._id.toString() &&
      Array.isArray(data.transaction.ledgerEntries) &&
      data.transaction.ledgerEntries.length === 2 &&
      data.transaction.fromAccount?.user?.email
    ) {
      console.log("✓ TEST 5 PASSED: Full transaction detail with double-entry ledger records returned\n");
    } else {
      throw new Error(`Failed to retrieve transaction detail or ledger entries: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    console.error("✗ TEST 5 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 6 — ADMIN -> users list (verify NO password/hash exposed)
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 6: ADMIN -> GET /api/admin/users ---");
    const res = await fetch(`${BASE_URL}/admin/users?page=1&limit=5&search=${encodeURIComponent(adminUser.name)}`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    const data = await res.json();
    console.log(`HTTP Status: ${res.status}`);
    console.log(`Users count: ${data.users?.length}`);

    // Critical security check: ensure password or password hash is NOT leaked
    let passwordExposed = false;
    for (const u of data.users) {
      if (u.password !== undefined || u.hash !== undefined) {
        passwordExposed = true;
        break;
      }
    }

    if (res.status === 200 && data.users.length >= 1 && !passwordExposed) {
      console.log("✓ TEST 6 PASSED: Users list returned without password or secret leakage\n");
    } else {
      throw new Error(`Security violation or empty users list: passwordExposed=${passwordExposed}`);
    }
  } catch (err) {
    console.error("✗ TEST 6 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 7 — Invalid transaction ObjectId
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 7: Invalid transaction ObjectId ---");
    const res = await fetch(`${BASE_URL}/admin/transactions/invalid-object-id-1234`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    const data = await res.json();
    console.log(`HTTP Status: ${res.status}, Response:`, JSON.stringify(data));

    if (res.status === 400 && data.message === "Invalid transaction ID format") {
      console.log("✓ TEST 7 PASSED: Clean 400 returned for malformed ObjectId\n");
    } else {
      throw new Error(`Expected 400, got ${res.status}`);
    }
  } catch (err) {
    console.error("✗ TEST 7 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 8 — Non-existent transaction ID
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 8: Non-existent transaction ID ---");
    const randomValidId = new mongoose.Types.ObjectId();
    const res = await fetch(`${BASE_URL}/admin/transactions/${randomValidId}`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    const data = await res.json();
    console.log(`HTTP Status: ${res.status}, Response:`, JSON.stringify(data));

    if (res.status === 404 && data.message === "Transaction not found") {
      console.log("✓ TEST 8 PASSED: Clean 404 returned for non-existent transaction\n");
    } else {
      throw new Error(`Expected 404, got ${res.status}`);
    }
  } catch (err) {
    console.error("✗ TEST 8 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 9 — Invalid pagination values
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 9: Invalid pagination values ---");
    const [resPage0, resLimitNeg, resLimitHuge] = await Promise.all([
      fetch(`${BASE_URL}/admin/transactions?page=0`, { headers: { "Authorization": `Bearer ${adminToken}` } }),
      fetch(`${BASE_URL}/admin/transactions?limit=-1`, { headers: { "Authorization": `Bearer ${adminToken}` } }),
      fetch(`${BASE_URL}/admin/transactions?limit=100000`, { headers: { "Authorization": `Bearer ${adminToken}` } })
    ]);

    const data0 = await resPage0.json();
    const dataNeg = await resLimitNeg.json();
    const dataHuge = await resLimitHuge.json();

    console.log(`page=0 Status: ${resPage0.status} (${data0.message})`);
    console.log(`limit=-1 Status: ${resLimitNeg.status} (${dataNeg.message})`);
    console.log(`limit=100000 Status: ${resLimitHuge.status} (${dataHuge.message})`);

    if (resPage0.status === 400 && resLimitNeg.status === 400 && resLimitHuge.status === 400) {
      console.log("✓ TEST 9 PASSED: Invalid pagination rejected with clean 400 error\n");
    } else {
      throw new Error(`Pagination bounds not enforced: page0=${resPage0.status}, limitNeg=${resLimitNeg.status}, limitHuge=${resLimitHuge.status}`);
    }
  } catch (err) {
    console.error("✗ TEST 9 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 10 — Blacklisted admin token
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 10: Blacklisted admin token ---");
    const logoutRes = await fetch(`${BASE_URL}/auth/logout`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    console.log(`Logout Status: ${logoutRes.status}`);

    const res = await fetch(`${BASE_URL}/admin/dashboard/stats`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    const data = await res.json();
    console.log(`Access with blacklisted token Status: ${res.status}, Response:`, JSON.stringify(data));

    if (res.status === 401 && data.message === "Unauthorized access,token is invalid") {
      console.log("✓ TEST 10 PASSED: Blacklisted admin token immediately rejected by auth middleware\n");
    } else {
      throw new Error(`Expected 401, got ${res.status}`);
    }
  } catch (err) {
    console.error("✗ TEST 10 FAILED:", err.message, "\n");
    allPassed = false;
  }

  await mongoose.disconnect();

  console.log("==========================================================");
  if (allPassed) {
    console.log("       ALL 10 ADMIN MONITORING API TESTS PASSED!          ");
  } else {
    console.log("       SOME TESTS FAILED! PLEASE REVIEW OUTPUT.           ");
  }
  console.log("==========================================================");
}

runAdminMonitoringTests().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
