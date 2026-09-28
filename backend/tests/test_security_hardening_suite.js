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
const tokenBlackListModel = require("../src/models/blacklist.model");

const BASE_URL = "http://localhost:3000/api";

function generateAuthToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), role: user.role || "USER" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

async function runSecurityHardeningTests() {
  console.log("==========================================================");
  console.log("    RATE LIMITING & SECURITY HARDENING TEST SUITE         ");
  console.log("==========================================================");

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB Atlas successfully.\n");

  const testSuffix = Date.now();
  let allPassed = true;

  // Setup: Create test user, admin user, and accounts
  const normalUser = await userModel.create({
    name: `Sec Normal ${testSuffix}`,
    email: `sec_normal_${testSuffix}@example.com`,
    password: "Password123!",
    role: "USER"
  });

  const adminUser = await userModel.create({
    name: `Sec Admin ${testSuffix}`,
    email: `sec_admin_${testSuffix}@example.com`,
    password: "Password123!",
    role: "ADMIN"
  });

  const recipientUser = await userModel.create({
    name: `Sec Recipient ${testSuffix}`,
    email: `sec_recip_${testSuffix}@example.com`,
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

  // Seed funds (100,000 INR)
  const seedTx = await transactionModel.create({
    fromAccount: userAccount._id,
    toAccount: userAccount._id,
    amount: 100000,
    status: "COMPLETED",
    idempotencyKey: `sec_seed_${testSuffix}`
  });

  await ledgerModel.create({
    account: userAccount._id,
    amount: 100000,
    transaction: seedTx._id,
    type: "CREDIT"
  });

  const userToken = generateAuthToken(normalUser);
  const adminToken = generateAuthToken(adminUser);

  // ----------------------------------------------------
  // TEST 1: Repeated Login Requests Eventually Receive 429
  // ----------------------------------------------------
  console.log("TEST 1: Repeated login attempts from same IP trigger HTTP 429 Too Many Requests...");
  try {
    const testIp = `192.168.100.${Math.floor(Math.random() * 200) + 10}`;
    let hit429 = false;
    let attempts = 0;

    for (let i = 0; i < 25; i++) {
      attempts++;
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Test-Client-Ip": testIp
        },
        body: JSON.stringify({
          email: "nonexistent@example.com",
          password: "WrongPassword123!"
        })
      });

      if (res.status === 429) {
        hit429 = true;
        const data = await res.json();
        if (!data.message || !data.message.includes("Too many")) {
          throw new Error(`Unexpected 429 message: ${data.message}`);
        }
        break;
      }
    }

    if (!hit429) {
      throw new Error(`Did not receive 429 after ${attempts} attempts`);
    }

    console.log(`  PASS: Rate limiter engaged after ${attempts} requests with HTTP 429.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // ----------------------------------------------------
  // TEST 2: Normal Login Still Works Below the Limit
  // ----------------------------------------------------
  console.log("TEST 2: Normal login works when under limit, returning 200 and hardened cookie...");
  try {
    const freshIp = `192.168.101.${Math.floor(Math.random() * 200) + 10}`;
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Test-Client-Ip": freshIp
      },
      body: JSON.stringify({
        email: `sec_normal_${testSuffix}@example.com`,
        password: "Password123!"
      })
    });

    if (res.status !== 200) {
      const body = await res.text();
      throw new Error(`Expected HTTP 200, got ${res.status}: ${body}`);
    }

    const data = await res.json();
    if (!data.token) throw new Error("Expected token in response body");

    const cookieHeader = res.headers.get("set-cookie") || "";
    if (!cookieHeader.includes("HttpOnly")) {
      throw new Error("Security failure: HttpOnly missing from auth cookie");
    }
    if (!cookieHeader.includes("SameSite=Lax") && !cookieHeader.includes("SameSite=lax")) {
      throw new Error("Security failure: SameSite=Lax missing from auth cookie");
    }

    console.log("  PASS: Normal login succeeds with 200 and hardened HttpOnly cookie.\n");
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // ----------------------------------------------------
  // TEST 3: Repeated Transaction Requests Eventually Receive 429
  // ----------------------------------------------------
  console.log("TEST 3: Repeated transaction creation flooding triggers HTTP 429...");
  try {
    // Dedicated user for transaction rate limit test
    const floodUser = await userModel.create({
      name: `Flood User ${testSuffix}`,
      email: `flood_${testSuffix}@example.com`,
      password: "Password123!",
      role: "USER"
    });
    const floodAccount = await accountModel.create({
      user: floodUser._id,
      currency: "INR",
      status: "ACTIVE"
    });
    const floodToken = generateAuthToken(floodUser);

    let hit429 = false;
    let txAttempts = 0;

    for (let i = 0; i < 65; i++) {
      txAttempts++;
      const res = await fetch(`${BASE_URL}/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${floodToken}`
        },
        body: JSON.stringify({
          // Missing mandatory fields allows instant in-memory rejection by controller,
          // ensuring all 65 requests arrive well within the 60-second rate limiter window
          idempotencyKey: `flood_tx_${testSuffix}_${i}`
        })
      });

      if (res.status === 429) {
        hit429 = true;
        const data = await res.json();
        if (!data.message || !data.message.includes("Too many")) {
          throw new Error(`Unexpected 429 message: ${data.message}`);
        }
        break;
      }
    }

    if (!hit429) {
      throw new Error(`Did not receive 429 for transactions after ${txAttempts} requests`);
    }

    console.log(`  PASS: Transaction rate limiter engaged after ${txAttempts} requests with HTTP 429.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // ----------------------------------------------------
  // TEST 4: Legitimate Transaction Still Works Under the Limit
  // ----------------------------------------------------
  console.log("TEST 4: Legitimate transaction works cleanly when under the limit...");
  try {
    const idempotencyKey = `sec_tx_clean_${testSuffix}`;
    const res = await fetch(`${BASE_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userToken}`
      },
      body: JSON.stringify({
        fromAccount: userAccount._id.toString(),
        toAccount: recipientAccount._id.toString(),
        amount: 250,
        idempotencyKey
      })
    });

    if (res.status !== 201) {
      const body = await res.text();
      throw new Error(`Expected HTTP 201, got ${res.status}: ${body}`);
    }

    const data = await res.json();
    if (!data.transaction || data.transaction.status !== "COMPLETED") {
      throw new Error("Transaction was not completed successfully");
    }

    console.log("  PASS: Legitimate transaction completed with HTTP 201 and full ledger entry.\n");
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // ----------------------------------------------------
  // TEST 5: Normal USER Cannot Access Admin APIs
  // ----------------------------------------------------
  console.log("TEST 5: Normal USER receives 403 Forbidden on admin APIs...");
  try {
    const res = await fetch(`${BASE_URL}/admin/dashboard/stats`, {
      headers: { "Authorization": `Bearer ${userToken}` }
    });

    if (res.status !== 403) {
      throw new Error(`Expected HTTP 403 Forbidden, got ${res.status}`);
    }

    console.log("  PASS: Admin authorization correctly denied normal user with HTTP 403.\n");
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // ----------------------------------------------------
  // TEST 6: Blacklisted JWT Returns 401
  // ----------------------------------------------------
  console.log("TEST 6: Blacklisted JWT remains rejected with 401 Unauthorized...");
  try {
    const tempUser = await userModel.create({
      name: `Blk Test ${testSuffix}`,
      email: `blk_test_${testSuffix}@example.com`,
      password: "Password123!",
      role: "USER"
    });
    const tempToken = generateAuthToken(tempUser);

    // Blacklist token directly
    await tokenBlackListModel.create({ token: tempToken });

    const res = await fetch(`${BASE_URL}/accounts`, {
      headers: { "Authorization": `Bearer ${tempToken}` }
    });

    if (res.status !== 401) {
      throw new Error(`Expected HTTP 401 for blacklisted token, got ${res.status}`);
    }

    console.log("  PASS: Blacklisted JWT immediately rejected with 401.\n");
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // ----------------------------------------------------
  // TEST 7: Invalid JWT Returns 401
  // ----------------------------------------------------
  console.log("TEST 7: Invalid/tampered JWT returns 401 Unauthorized...");
  try {
    const fakeToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.tamperedSignatureHere";
    const res = await fetch(`${BASE_URL}/accounts`, {
      headers: { "Authorization": `Bearer ${fakeToken}` }
    });

    if (res.status !== 401) {
      throw new Error(`Expected HTTP 401 for invalid JWT, got ${res.status}`);
    }

    console.log("  PASS: Malformed/forged JWT rejected with 401.\n");
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // ----------------------------------------------------
  // TEST 8: Malformed or Oversized Body is Rejected Safely
  // ----------------------------------------------------
  console.log("TEST 8: Malformed and oversized JSON payloads are rejected safely without crashes...");
  try {
    // 1. Malformed JSON
    const malformedRes = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ invalid json payload here : "
    });

    if (malformedRes.status !== 400) {
      throw new Error(`Expected 400 for malformed JSON, got ${malformedRes.status}`);
    }
    const malformedData = await malformedRes.json();
    if (!malformedData.message || !malformedData.message.includes("Malformed JSON")) {
      throw new Error(`Unexpected message for malformed JSON: ${malformedData.message}`);
    }

    // 2. Oversized payload (> 50kb)
    const largeString = "A".repeat(60 * 1024); // 60KB
    const largeRes = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", padding: largeString })
    });

    if (largeRes.status !== 413) {
      throw new Error(`Expected 413 Payload Too Large for 60KB body, got ${largeRes.status}`);
    }

    console.log("  PASS: Malformed payload rejected with 400; oversized payload rejected with 413.\n");
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // ----------------------------------------------------
  // TEST 9: CORS Configuration Behaves Correctly for Allowed Origin
  // ----------------------------------------------------
  console.log("TEST 9: CORS correctly allows configured frontend origin with credentials...");
  try {
    const res = await fetch(`${BASE_URL}/auth/me`, {
      method: "OPTIONS",
      headers: {
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "GET"
      }
    });

    const allowOrigin = res.headers.get("access-control-allow-origin");
    const allowCreds = res.headers.get("access-control-allow-credentials");

    if (allowOrigin !== "http://localhost:5173") {
      throw new Error(`Expected Access-Control-Allow-Origin: http://localhost:5173, got ${allowOrigin}`);
    }
    if (allowCreds !== "true") {
      throw new Error(`Expected Access-Control-Allow-Credentials: true, got ${allowCreds}`);
    }

    console.log("  PASS: CORS properly permits authorized origin http://localhost:5173 with credentials.\n");
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // ----------------------------------------------------
  // TEST 10: Unauthorized Origin is Not Granted Credentialed Access
  // ----------------------------------------------------
  console.log("TEST 10: Unauthorized origin is rejected by CORS policy...");
  try {
    const res = await fetch(`${BASE_URL}/auth/me`, {
      method: "GET",
      headers: {
        "Origin": "http://malicious-attacker-site.com",
        "Authorization": `Bearer ${userToken}`
      }
    });

    const allowOrigin = res.headers.get("access-control-allow-origin");
    if (allowOrigin === "http://malicious-attacker-site.com" || allowOrigin === "*") {
      throw new Error(`Security breach: unauthorized origin was granted access: ${allowOrigin}`);
    }

    console.log("  PASS: Unauthorized origin was blocked from cross-origin credential access.\n");
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // ----------------------------------------------------
  // TEST 11: Error Responses Do Not Expose Stack Traces or Internal Details
  // ----------------------------------------------------
  console.log("TEST 11: Application error responses protect against information disclosure...");
  try {
    // Attempt triggering a route error
    const res = await fetch(`${BASE_URL}/undefined-route-${testSuffix}`);
    const text = await res.text();

    if (text.includes("node_modules") || text.includes("at Function.") || text.includes("MONGO_URI")) {
      throw new Error("Information disclosure detected in 404 response!");
    }

    const data = JSON.parse(text);
    if (!data.message) {
      throw new Error("Expected JSON message on 404");
    }

    // Inspect security headers added by Helmet
    const resHeaders = await fetch(`${BASE_URL}/admin/health`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });

    const nosniff = resHeaders.headers.get("x-content-type-options");
    const frameOptions = resHeaders.headers.get("x-frame-options");

    if (nosniff !== "nosniff") {
      throw new Error(`Missing or invalid X-Content-Type-Options: ${nosniff}`);
    }
    if (!frameOptions) {
      throw new Error("Missing X-Frame-Options header");
    }

    console.log("  PASS: Stack traces suppressed. Helmet security headers (nosniff, frame-options) present.\n");
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  // ----------------------------------------------------
  // TEST 12: Existing Financial Integrity & Concurrency Guarantees Maintained
  // ----------------------------------------------------
  console.log("TEST 12: Financial integrity, double-spend protection, and ledger balance derivation intact...");
  try {
    // Initial balance check
    const startBalance = await userAccount.getBalance();

    // Perform two transfers
    const tx1Key = `sec_tx_fin1_${testSuffix}`;
    const r1 = await fetch(`${BASE_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userToken}`
      },
      body: JSON.stringify({
        fromAccount: userAccount._id.toString(),
        toAccount: recipientAccount._id.toString(),
        amount: 500,
        idempotencyKey: tx1Key
      })
    });

    if (r1.status !== 201) throw new Error(`Transfer 1 failed: ${r1.status}`);

    // Replay same idempotencyKey
    const r1Replay = await fetch(`${BASE_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userToken}`
      },
      body: JSON.stringify({
        fromAccount: userAccount._id.toString(),
        toAccount: recipientAccount._id.toString(),
        amount: 500,
        idempotencyKey: tx1Key
      })
    });

    if (r1Replay.status !== 200) throw new Error(`Idempotency replay failed: ${r1Replay.status}`);

    const endBalance = await userAccount.getBalance();
    const expectedEnd = startBalance - 500;

    if (endBalance !== expectedEnd) {
      throw new Error(`Balance derivation mismatch! Expected: ${expectedEnd}, got: ${endBalance}`);
    }

    console.log(`  PASS: Financial integrity preserved. Balance deducted exactly ₹500 (${startBalance} -> ${endBalance}). Idempotency safe.\n`);
  } catch (err) {
    allPassed = false;
    console.error("  FAIL:", err.message, "\n");
  }

  await mongoose.disconnect();

  console.log("==========================================================");
  if (allPassed) {
    console.log("  ALL 12 SECURITY HARDENING & RATE LIMIT TESTS PASSED     ");
  } else {
    console.log("  SOME SECURITY HARDENING TESTS FAILED. CHECK LOGS ABOVE. ");
  }
  console.log("==========================================================");

  if (!allPassed) {
    process.exit(1);
  }
}

runSecurityHardeningTests().catch(err => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
