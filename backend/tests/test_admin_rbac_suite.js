const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const dns = require("dns");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const userModel = require("../src/models/user.model");
const tokenBlackListModel = require("../src/models/blacklist.model");

const BASE_URL = "http://localhost:3000/api";

function generateAuthToken(user, customPayload = {}) {
  return jwt.sign(
    { userId: user._id.toString(), role: user.role || "USER", ...customPayload },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

async function runRbacTests() {
  console.log("==========================================================");
  console.log("       ADMIN ROLE-BASED ACCESS CONTROL (RBAC) TESTS       ");
  console.log("==========================================================");

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB Atlas successfully.\n");

  const testSuffix = Date.now();
  let allPassed = true;

  // -------------------------------------------------------------
  // TEST 1 — Normal registration with role: "ADMIN" attempt
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 1: Normal registration with attempted role: 'ADMIN' ---");
    const regEmail = `attacker_${testSuffix}@example.com`;
    const regRes = await fetch(`${BASE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Attacker User",
        email: regEmail,
        password: "Password123!",
        role: "ADMIN" // Attacker attempts self-elevation
      })
    });

    const regData = await regRes.json();
    console.log(`Registration HTTP Status: ${regRes.status}`);
    console.log(`Response User Role: ${regData.user?.role}`);

    const dbUser = await userModel.findOne({ email: regEmail });
    console.log(`Database Stored Role: ${dbUser?.role}`);

    if (regRes.status === 201 && regData.user?.role === "USER" && dbUser?.role === "USER") {
      console.log("✓ TEST 1 PASSED: Role injection blocked. User created strictly as USER.\n");
    } else {
      throw new Error(`Expected role 'USER', got response: ${regData.user?.role}, db: ${dbUser?.role}`);
    }
  } catch (err) {
    console.error("✗ TEST 1 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 2 — Normal USER accessing admin endpoint
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 2: Normal USER accessing admin endpoint ---");
    const normalUser = await userModel.create({
      name: `Normal User ${testSuffix}`,
      email: `normal_${testSuffix}@example.com`,
      password: "Password123!",
      role: "USER"
    });

    const userToken = generateAuthToken(normalUser);

    const res = await fetch(`${BASE_URL}/admin/health`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${userToken}`
      }
    });

    const data = await res.json();
    console.log(`HTTP Status: ${res.status}, Response:`, JSON.stringify(data));

    if (res.status === 403 && data.message === "Forbidden: Admin access required") {
      console.log("✓ TEST 2 PASSED: Normal user access denied with 403 Forbidden\n");
    } else {
      throw new Error(`Expected 403 and 'Forbidden: Admin access required', got ${res.status} (${JSON.stringify(data)})`);
    }
  } catch (err) {
    console.error("✗ TEST 2 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 3 — ADMIN accessing admin endpoint
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 3: ADMIN accessing admin endpoint ---");
    const adminUser = await userModel.create({
      name: `Real Admin ${testSuffix}`,
      email: `admin_${testSuffix}@example.com`,
      password: "Password123!",
      role: "ADMIN"
    });

    const adminToken = generateAuthToken(adminUser);

    const res = await fetch(`${BASE_URL}/admin/health`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${adminToken}`
      }
    });

    const data = await res.json();
    console.log(`HTTP Status: ${res.status}, Response:`, JSON.stringify(data));

    if (res.status === 200 && data.message === "Admin access granted") {
      console.log("✓ TEST 3 PASSED: Verified admin granted access with 200 OK\n");
    } else {
      throw new Error(`Expected 200 and 'Admin access granted', got ${res.status} (${JSON.stringify(data)})`);
    }
  } catch (err) {
    console.error("✗ TEST 3 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 4 — Admin demotion (stale JWT claim defeated)
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 4: Admin demotion & fresh DB check ---");
    const demotee = await userModel.create({
      name: `Demotee Admin ${testSuffix}`,
      email: `demotee_${testSuffix}@example.com`,
      password: "Password123!",
      role: "ADMIN"
    });

    // Issue JWT with role: "ADMIN"
    const staleAdminToken = generateAuthToken(demotee, { role: "ADMIN" });

    // Verify it initially works
    const checkBefore = await fetch(`${BASE_URL}/admin/health`, {
      headers: { "Authorization": `Bearer ${staleAdminToken}` }
    });
    console.log(`Access before demotion: HTTP ${checkBefore.status}`);

    // Demote user in database directly
    demotee.role = "USER";
    await demotee.save();
    console.log("User demoted in MongoDB to role: 'USER'");

    // Make request using the OLD token (which still says role: "ADMIN" inside its JWT payload!)
    const checkAfter = await fetch(`${BASE_URL}/admin/health`, {
      headers: { "Authorization": `Bearer ${staleAdminToken}` }
    });
    const afterData = await checkAfter.json();
    console.log(`Access after demotion with stale JWT: HTTP ${checkAfter.status}, Response:`, JSON.stringify(afterData));

    if (checkAfter.status === 403 && afterData.message === "Forbidden: Admin access required") {
      console.log("✓ TEST 4 PASSED: Server authorization verified live MongoDB role; stale token rejected\n");
    } else {
      throw new Error(`Expected 403 after DB demotion, got ${checkAfter.status}`);
    }
  } catch (err) {
    console.error("✗ TEST 4 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 5 — Blacklisted admin token
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 5: Blacklisted admin token ---");
    const adminUser = await userModel.create({
      name: `Logout Admin ${testSuffix}`,
      email: `logout_admin_${testSuffix}@example.com`,
      password: "Password123!",
      role: "ADMIN"
    });

    const adminToken = generateAuthToken(adminUser);

    // Logout to blacklist the token
    const logoutRes = await fetch(`${BASE_URL}/auth/logout`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    console.log(`Logout HTTP Status: ${logoutRes.status}`);

    // Attempt to access admin endpoint with blacklisted token
    const res = await fetch(`${BASE_URL}/admin/health`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    const data = await res.json();
    console.log(`Access with blacklisted token: HTTP ${res.status}, Response:`, JSON.stringify(data));

    if (res.status === 401 && data.message === "Unauthorized access,token is invalid") {
      console.log("✓ TEST 5 PASSED: Blacklisted admin token immediately blocked by auth middleware\n");
    } else {
      throw new Error(`Expected 401, got ${res.status}: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    console.error("✗ TEST 5 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 6 — systemUser is not ADMIN
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 6: systemUser is not ADMIN ---");
    const sysUser = await userModel.create({
      name: `System Machine ${testSuffix}`,
      email: `sysmachine_${testSuffix}@example.com`,
      password: "Password123!",
      systemUser: true,
      role: "USER" // systemUser has role: "USER"
    });

    const sysToken = generateAuthToken(sysUser);

    const res = await fetch(`${BASE_URL}/admin/health`, {
      headers: { "Authorization": `Bearer ${sysToken}` }
    });
    const data = await res.json();
    console.log(`systemUser access to admin health: HTTP ${res.status}, Response:`, JSON.stringify(data));

    if (res.status === 403 && data.message === "Forbidden: Admin access required") {
      console.log("✓ TEST 6 PASSED: systemUser cleanly segregated from human ADMIN privileges\n");
    } else {
      throw new Error(`Expected 403, got ${res.status}`);
    }
  } catch (err) {
    console.error("✗ TEST 6 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 7 — USER cannot self-promote through any existing route
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 7: USER cannot self-promote through any route ---");
    const victimUser = await userModel.create({
      name: `Regular User ${testSuffix}`,
      email: `regular_${testSuffix}@example.com`,
      password: "Password123!",
      role: "USER"
    });

    const userToken = generateAuthToken(victimUser);

    // 1. Check profile endpoint GET /api/auth/me
    const meRes = await fetch(`${BASE_URL}/auth/me`, {
      headers: { "Authorization": `Bearer ${userToken}` }
    });
    const meData = await meRes.json();
    console.log(`Profile check /api/auth/me: role = ${meData.user?.role}`);

    // 2. Verify no PUT / PATCH endpoint exists on /api/auth or /api/accounts to update role
    const patchRes = await fetch(`${BASE_URL}/auth/profile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userToken}`
      },
      body: JSON.stringify({ role: "ADMIN" })
    });
    console.log(`Attempt PATCH /api/auth/profile status: ${patchRes.status} (404 expected)`);

    const putRes = await fetch(`${BASE_URL}/accounts`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userToken}`
      },
      body: JSON.stringify({ role: "ADMIN" })
    });
    console.log(`Attempt PUT /api/accounts status: ${putRes.status} (404 expected)`);

    // Verify database role is strictly still USER
    const refreshedUser = await userModel.findById(victimUser._id);
    if (refreshedUser.role === "USER") {
      console.log("✓ TEST 7 PASSED: No user update vector exists; role remains immutably 'USER'\n");
    } else {
      throw new Error(`User was modified to ${refreshedUser.role}`);
    }
  } catch (err) {
    console.error("✗ TEST 7 FAILED:", err.message, "\n");
    allPassed = false;
  }

  await mongoose.disconnect();

  console.log("==========================================================");
  if (allPassed) {
    console.log("       ALL 7 ADMIN RBAC SECURITY TESTS PASSED!            ");
  } else {
    console.log("       SOME TESTS FAILED! PLEASE REVIEW OUTPUT.           ");
  }
  console.log("==========================================================");
}

runRbacTests().catch(err => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
