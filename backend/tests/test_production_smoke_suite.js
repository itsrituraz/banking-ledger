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

const BASE_URL = "http://localhost:3000";

function generateAuthToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), role: user.role || "USER" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

async function runProductionSmokeTests() {
  console.log("==========================================================");
  console.log("             PRODUCTION SMOKE TEST SUITE                  ");
  console.log("==========================================================");

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB Atlas successfully.\n");

  const testSuffix = Date.now();
  let allPassed = true;

  // Setup: Create test fixtures
  const passwordPlain = "SmokeTest123!";
  const normalUserA = await userModel.create({
    name: `Smoke User A ${testSuffix}`,
    email: `smoke_user_a_${testSuffix}@example.com`,
    password: passwordPlain,
    role: "USER"
  });

  const normalUserB = await userModel.create({
    name: `Smoke User B ${testSuffix}`,
    email: `smoke_user_b_${testSuffix}@example.com`,
    password: passwordPlain,
    role: "USER"
  });

  const adminUser = await userModel.create({
    name: `Smoke Admin ${testSuffix}`,
    email: `smoke_admin_${testSuffix}@example.com`,
    password: passwordPlain,
    role: "ADMIN"
  });

  const userTokenA = generateAuthToken(normalUserA);
  const userTokenB = generateAuthToken(normalUserB);
  const adminToken = generateAuthToken(adminUser);

  const accountA = await accountModel.create({
    user: normalUserA._id,
    currency: "INR",
    status: "ACTIVE"
  });

  const accountB = await accountModel.create({
    user: normalUserB._id,
    currency: "INR",
    status: "ACTIVE"
  });

  // Seed funds (1,000,000 INR) into accountA for tests
  const seedTx = await transactionModel.create({
    fromAccount: accountA._id,
    toAccount: accountA._id,
    amount: 1000000,
    status: "COMPLETED",
    idempotencyKey: `smoke_seed_${testSuffix}`,
    riskScore: 0,
    riskStatus: "APPROVED"
  });

  await ledgerModel.create({
    account: accountA._id,
    amount: 1000000,
    type: "CREDIT",
    transaction: seedTx._id
  });

  // -------------------------------------------------------------
  // TEST 1: Health Endpoints Return Expected Status
  // -------------------------------------------------------------
  console.log("TEST 1: Health Endpoints Return Expected Status (/health & /health/ready)");
  try {
    const livenessRes = await fetch(`${BASE_URL}/health`);
    if (livenessRes.status !== 200) {
      throw new Error(`Expected 200 for /health, got ${livenessRes.status}`);
    }
    const livenessData = await livenessRes.json();
    if (livenessData.status !== "ok" || !livenessData.timestamp) {
      throw new Error("Liveness response missing status 'ok' or timestamp");
    }

    const readinessRes = await fetch(`${BASE_URL}/health/ready`);
    if (readinessRes.status !== 200) {
      throw new Error(`Expected 200 for /health/ready, got ${readinessRes.status}`);
    }
    const readinessData = await readinessRes.json();
    if (readinessData.status !== "ready" || readinessData.database !== "connected") {
      throw new Error("Readiness response missing 'ready' or 'connected'");
    }

    console.log(`  PASS: Liveness (/health) returned 'ok' and Readiness (/health/ready) verified database connection.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 2: Missing and Invalid JWT Rejected (401)
  // -------------------------------------------------------------
  console.log("TEST 2: Missing and Invalid JWT Is Rejected With HTTP 401");
  try {
    // Missing token
    const resNoToken = await fetch(`${BASE_URL}/api/accounts`);
    if (resNoToken.status !== 401) {
      throw new Error(`Expected 401 for missing token, got ${resNoToken.status}`);
    }

    // Invalid / forged token
    const resInvalidToken = await fetch(`${BASE_URL}/api/accounts`, {
      headers: { "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.token" }
    });
    if (resInvalidToken.status !== 401) {
      throw new Error(`Expected 401 for invalid token, got ${resInvalidToken.status}`);
    }

    console.log("  PASS: Protected endpoint rejected both missing and forged JWT tokens with 401.\n");
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 3: Normal USER Cannot Access ADMIN Endpoints (403)
  // -------------------------------------------------------------
  console.log("TEST 3: Normal USER Cannot Access Admin Endpoint (HTTP 403)");
  try {
    const res = await fetch(`${BASE_URL}/api/admin/dashboard/stats`, {
      headers: { "Authorization": `Bearer ${userTokenA}` }
    });

    if (res.status !== 403) {
      throw new Error(`Expected 403 Forbidden for USER on admin route, got ${res.status}`);
    }

    console.log("  PASS: Normal user blocked from admin endpoint with HTTP 403.\n");
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 4: ADMIN Can Access Admin Endpoint (200)
  // -------------------------------------------------------------
  console.log("TEST 4: ADMIN Can Access Admin Endpoint (HTTP 200)");
  try {
    const res = await fetch(`${BASE_URL}/api/admin/dashboard/stats`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });

    if (res.status !== 200) {
      throw new Error(`Expected 200 OK for admin on admin route, got ${res.status}`);
    }

    const data = await res.json();
    if (typeof data.totalUsers !== "number" || typeof data.totalTransactions !== "number") {
      throw new Error("Admin stats payload missing required counters");
    }

    console.log(`  PASS: Admin granted access with valid counters (totalUsers: ${data.totalUsers}).\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 5: Normal Transaction Works (HTTP 201)
  // -------------------------------------------------------------
  console.log("TEST 5: Normal Legitimate Transaction Still Works (HTTP 201)");
  let normalTxId = null;
  const normalIdemKey = `smoke-normal-tx-${testSuffix}`;
  try {
    const res = await fetch(`${BASE_URL}/api/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userTokenA}`
      },
      body: JSON.stringify({
        fromAccount: accountA._id.toString(),
        toAccount: accountB._id.toString(),
        amount: 2500,
        idempotencyKey: normalIdemKey
      })
    });

    if (res.status !== 201) {
      const errBody = await res.text();
      throw new Error(`Expected 201 Created, got ${res.status}: ${errBody}`);
    }

    const data = await res.json();
    if (!data.transaction || data.transaction.status !== "COMPLETED") {
      throw new Error("Transaction was not marked COMPLETED");
    }

    normalTxId = data.transaction.id || data.transaction._id;
    console.log(`  PASS: Legitimate transaction processed successfully (Tx ID: ${normalTxId}).\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 6: Risk-Blocked Transaction Remains Blocked (403)
  // -------------------------------------------------------------
  console.log("TEST 6: Risk-Blocked Transaction Remains Blocked (HTTP 403)");
  try {
    // Create new recipient so FIRST_TIME_BENEFICIARY triggers (+20), transfer 60,000 (+35)
    // on newly created account (+10) -> Score 65 -> MANUAL_REVIEW -> Blocked 403
    const freshUser = await userModel.create({
      name: `Risk Target ${testSuffix}`,
      email: `risk_target_${testSuffix}@example.com`,
      password: passwordPlain,
      role: "USER"
    });
    const freshAccount = await accountModel.create({
      user: freshUser._id,
      currency: "INR",
      status: "ACTIVE"
    });

    const res = await fetch(`${BASE_URL}/api/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userTokenA}`
      },
      body: JSON.stringify({
        fromAccount: accountA._id.toString(),
        toAccount: freshAccount._id.toString(),
        amount: 60000,
        idempotencyKey: `smoke-risk-blocked-${testSuffix}`
      })
    });

    if (res.status !== 403) {
      throw new Error(`Expected 403 Forbidden for high risk transfer, got ${res.status}`);
    }

    const body = await res.json();
    console.log(`  PASS: Risk engine blocked suspicious transfer with HTTP 403 (message: "${body.message}").\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 7: Idempotent Transaction Replay Remains Safe
  // -------------------------------------------------------------
  console.log("TEST 7: Idempotent Replay Returns Cached Transaction With Zero Duplicate Debits");
  try {
    const res = await fetch(`${BASE_URL}/api/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userTokenA}`
      },
      body: JSON.stringify({
        fromAccount: accountA._id.toString(),
        toAccount: accountB._id.toString(),
        amount: 2500,
        idempotencyKey: normalIdemKey
      })
    });

    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`Expected 200/201 on replay, got ${res.status}`);
    }

    const ledgerCount = await ledgerModel.countDocuments({ transaction: normalTxId });
    if (ledgerCount !== 2) {
      throw new Error(`Duplicate ledger entries created! Expected 2, got ${ledgerCount}`);
    }

    console.log(`  PASS: Replay returned cached transaction with 0 duplicate ledger records (count: ${ledgerCount}).\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 8: Concurrent Double-Spend Protection Intact
  // -------------------------------------------------------------
  console.log("TEST 8: Concurrent Double-Spend Protection Remains Intact");
  try {
    // Create dedicated small-balance account with exactly 100
    const raceUser = await userModel.create({
      name: `Smoke Race ${testSuffix}`,
      email: `smoke_race_${testSuffix}@example.com`,
      password: passwordPlain,
      role: "USER"
    });
    const raceToken = generateAuthToken(raceUser);
    const raceAccount = await accountModel.create({
      user: raceUser._id,
      currency: "INR",
      status: "ACTIVE"
    });

    const fundTx = await transactionModel.create({
      fromAccount: raceAccount._id,
      toAccount: raceAccount._id,
      amount: 100,
      status: "COMPLETED",
      idempotencyKey: `smoke_race_fund_${testSuffix}`
    });
    await ledgerModel.create({
      account: raceAccount._id,
      amount: 100,
      type: "CREDIT",
      transaction: fundTx._id
    });

    // Fire 2 concurrent transfers of 80 each (total 160 > 100)
    const [t1, t2] = await Promise.all([
      fetch(`${BASE_URL}/api/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${raceToken}` },
        body: JSON.stringify({
          fromAccount: raceAccount._id.toString(),
          toAccount: accountB._id.toString(),
          amount: 80,
          idempotencyKey: `smoke_race_a_${testSuffix}`
        })
      }),
      fetch(`${BASE_URL}/api/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${raceToken}` },
        body: JSON.stringify({
          fromAccount: raceAccount._id.toString(),
          toAccount: accountB._id.toString(),
          amount: 80,
          idempotencyKey: `smoke_race_b_${testSuffix}`
        })
      })
    ]);

    const statuses = [t1.status, t2.status];
    const successes = statuses.filter(s => s === 200 || s === 201).length;
    if (successes !== 1) {
      throw new Error(`Expected exactly 1 success, got ${successes} (statuses: ${statuses.join(", ")})`);
    }

    const balRes = await fetch(`${BASE_URL}/api/accounts/balance/${raceAccount._id.toString()}`, {
      headers: { "Authorization": `Bearer ${raceToken}` }
    });
    const balData = await balRes.json();
    if (balData.balance !== 20) {
      throw new Error(`Unexpected post-race balance: expected 20, got ${balData.balance}`);
    }

    console.log(`  PASS: Double-spend rejected! Exactly 1 succeeded, remaining balance is 20 (never negative).\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 9: Security Headers Present (Helmet)
  // -------------------------------------------------------------
  console.log("TEST 9: Security Headers Present (Helmet Hardening)");
  try {
    const res = await fetch(`${BASE_URL}/health`);
    const nosniff = res.headers.get("x-content-type-options");
    const dnsPrefetch = res.headers.get("x-dns-prefetch-control");

    if (nosniff !== "nosniff") {
      throw new Error(`Expected x-content-type-options: nosniff, got ${nosniff}`);
    }
    if (dnsPrefetch !== "off") {
      throw new Error(`Expected x-dns-prefetch-control: off, got ${dnsPrefetch}`);
    }

    console.log(`  PASS: Security headers active: X-Content-Type-Options: ${nosniff}, X-DNS-Prefetch-Control: ${dnsPrefetch}.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 10: Unauthorized CORS Origin Blocked (403)
  // -------------------------------------------------------------
  console.log("TEST 10: Unauthorized CORS Origin Blocked (HTTP 403)");
  try {
    const res = await fetch(`${BASE_URL}/api/accounts`, {
      headers: {
        "Origin": "https://malicious-unauthorized-site.com",
        "Authorization": `Bearer ${userTokenA}`
      }
    });

    if (res.status !== 403) {
      throw new Error(`Expected 403 for unauthorized CORS origin, got ${res.status}`);
    }

    console.log("  PASS: Unauthorized origin rejected with HTTP 403.\n");
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 11: Oversized Request Body Rejected (HTTP 413)
  // -------------------------------------------------------------
  console.log("TEST 11: Oversized Request Body Rejected (HTTP 413 Payload Too Large)");
  try {
    const largePayload = {
      email: normalUserA.email,
      padding: "X".repeat(60 * 1024) // 60KB > 50KB limit
    };

    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(largePayload)
    });

    if (res.status !== 413) {
      throw new Error(`Expected 413 Payload Too Large, got ${res.status}`);
    }

    console.log("  PASS: 60KB payload rejected by body parser with HTTP 413.\n");
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // -------------------------------------------------------------
  // TEST 12: Rate Limiting Remains Active (HTTP 429)
  // -------------------------------------------------------------
  console.log("TEST 12: Rate Limiting Remains Active (HTTP 429 Too Many Requests)");
  try {
    const testIp = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;
    let hit429 = false;
    let attempts = 0;

    for (let i = 0; i < 25; i++) {
      attempts++;
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Test-Client-Ip": testIp
        },
        body: JSON.stringify({ email: "rate_smoke_test@example.com", password: "wrong" })
      });

      if (res.status === 429) {
        hit429 = true;
        break;
      }
    }

    if (!hit429) {
      throw new Error(`Did not trigger 429 rate limit after ${attempts} requests`);
    }

    console.log(`  PASS: Rate limiter engaged after ${attempts} rapid requests with HTTP 429.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // Teardown
  await mongoose.disconnect();

  console.log("==========================================================");
  if (allPassed) {
    console.log("     ALL 12 PRODUCTION SMOKE TESTS PASSED (12/12)         ");
  } else {
    console.log("     SOME PRODUCTION SMOKE TESTS FAILED. CHECK LOGS ABOVE. ");
  }
  console.log("==========================================================");

  if (!allPassed) {
    process.exit(1);
  }
}

runProductionSmokeTests().catch(err => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
