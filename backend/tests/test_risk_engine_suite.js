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
const riskEngineService = require("../src/services/riskEngine.service");

const BASE_URL = "http://localhost:3000/api";

function generateAuthToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

async function runTestSuite() {
  console.log("==========================================================");
  console.log("       FINTECH RISK & FRAUD ENGINE v1 TEST SUITE          ");
  console.log("==========================================================");

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB Atlas successfully.\n");

  const testSuffix = Date.now();

  // Create Test Users & Accounts
  const senderUser = await userModel.create({
    name: `Risk Sender ${testSuffix}`,
    email: `sender_${testSuffix}@example.com`,
    password: "Password123!"
  });

  const receiverUser1 = await userModel.create({
    name: `Risk Receiver 1 ${testSuffix}`,
    email: `receiver1_${testSuffix}@example.com`,
    password: "Password123!"
  });

  const receiverUser2 = await userModel.create({
    name: `Risk Receiver 2 ${testSuffix}`,
    email: `receiver2_${testSuffix}@example.com`,
    password: "Password123!"
  });

  const senderAccount = await accountModel.create({
    user: senderUser._id,
    currency: "INR",
    status: "ACTIVE"
  });

  const receiverAccount1 = await accountModel.create({
    user: receiverUser1._id,
    currency: "INR",
    status: "ACTIVE"
  });

  const receiverAccount2 = await accountModel.create({
    user: receiverUser2._id,
    currency: "INR",
    status: "ACTIVE"
  });

  // Seed initial balance of ₹2,00,000 to sender account via direct ledger credit
  const seedTx = await transactionModel.create({
    fromAccount: senderAccount._id,
    toAccount: senderAccount._id,
    amount: 200000,
    status: "COMPLETED",
    idempotencyKey: `seed_${testSuffix}`,
    riskScore: 0,
    riskStatus: "APPROVED"
  });

  await ledgerModel.create({
    account: senderAccount._id,
    amount: 200000,
    transaction: seedTx._id,
    type: "CREDIT"
  });

  const senderToken = generateAuthToken(senderUser);

  console.log(`Setup Complete.`);
  console.log(`Sender Account ID: ${senderAccount._id}`);
  console.log(`Initial Balance: ₹${await senderAccount.getBalance()}\n`);

  let allPassed = true;

  // -------------------------------------------------------------
  // TEST 1: Normal ₹100 transaction (Mature account, existing beneficiary)
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 1: Normal ₹100 transaction ---");
    // Pre-seed a completed transaction between sender and receiver1 so it's not a first-time beneficiary
    const priorTx = await transactionModel.create({
      fromAccount: senderAccount._id,
      toAccount: receiverAccount1._id,
      amount: 50,
      status: "COMPLETED",
      idempotencyKey: `prior_${testSuffix}`,
      riskScore: 0,
      riskStatus: "APPROVED"
    });

    // Set sender account age to > 24 hours ago for mature account test
    const matureAccountDoc = {
      _id: senderAccount._id,
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000)
    };

    const risk = await riskEngineService.calculateTransactionRisk({
      user: senderUser,
      fromAccount: senderAccount._id,
      fromAccountDoc: matureAccountDoc,
      toAccount: receiverAccount1._id,
      amount: 100
    });

    console.log(`Risk Score: ${risk.riskScore}, Status: ${risk.riskStatus}, Reasons: ${JSON.stringify(risk.riskReasons)}`);
    if (risk.riskScore < 30 && risk.riskStatus === "APPROVED") {
      console.log("✓ TEST 1 PASSED: Low score, APPROVED\n");
    } else {
      throw new Error(`Expected score < 30 and APPROVED, got score ${risk.riskScore}, status ${risk.riskStatus}`);
    }
  } catch (err) {
    console.error("✗ TEST 1 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 2: Large transaction (HIGH_TRANSACTION_AMOUNT)
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 2: Large transaction ---");
    const matureAccountDoc = {
      _id: senderAccount._id,
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000)
    };

    const risk = await riskEngineService.calculateTransactionRisk({
      user: senderUser,
      fromAccount: senderAccount._id,
      fromAccountDoc: matureAccountDoc,
      toAccount: receiverAccount1._id,
      amount: 15000 // >= 10,000 threshold
    });

    console.log(`Risk Score: ${risk.riskScore}, Status: ${risk.riskStatus}, Reasons: ${JSON.stringify(risk.riskReasons)}`);
    if (risk.riskReasons.includes("HIGH_TRANSACTION_AMOUNT") && risk.riskScore >= 20) {
      console.log("✓ TEST 2 PASSED: HIGH_TRANSACTION_AMOUNT triggered, score increased\n");
    } else {
      throw new Error(`Expected HIGH_TRANSACTION_AMOUNT in reasons, got ${JSON.stringify(risk.riskReasons)}`);
    }
  } catch (err) {
    console.error("✗ TEST 2 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 3: First transaction to a receiver (FIRST_TIME_BENEFICIARY)
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 3: First transaction to a receiver ---");
    const matureAccountDoc = {
      _id: senderAccount._id,
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000)
    };

    // receiverAccount2 has never received money from senderAccount
    const risk = await riskEngineService.calculateTransactionRisk({
      user: senderUser,
      fromAccount: senderAccount._id,
      fromAccountDoc: matureAccountDoc,
      toAccount: receiverAccount2._id,
      amount: 100
    });

    console.log(`Risk Score: ${risk.riskScore}, Status: ${risk.riskStatus}, Reasons: ${JSON.stringify(risk.riskReasons)}, isFirstTime: ${risk.isFirstTimeBeneficiary}`);
    if (risk.isFirstTimeBeneficiary === true && risk.riskReasons.includes("FIRST_TIME_BENEFICIARY")) {
      console.log("✓ TEST 3 PASSED: FIRST_TIME_BENEFICIARY triggered, isFirstTimeBeneficiary = true\n");
    } else {
      throw new Error(`Expected isFirstTimeBeneficiary = true and FIRST_TIME_BENEFICIARY, got ${risk.isFirstTimeBeneficiary}, ${JSON.stringify(risk.riskReasons)}`);
    }
  } catch (err) {
    console.error("✗ TEST 3 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 4: Repeated transactions in a short period (HIGH_TRANSACTION_VELOCITY)
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 4: Repeated transactions in a short period ---");
    // Insert 3 recent transactions within 30 seconds
    for (let i = 1; i <= 3; i++) {
      await transactionModel.create({
        fromAccount: senderAccount._id,
        toAccount: receiverAccount1._id,
        amount: 50,
        status: "COMPLETED",
        idempotencyKey: `vel_${testSuffix}_${i}`,
        createdAt: new Date(Date.now() - 10000 * i)
      });
    }

    const matureAccountDoc = {
      _id: senderAccount._id,
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000)
    };

    const risk = await riskEngineService.calculateTransactionRisk({
      user: senderUser,
      fromAccount: senderAccount._id,
      fromAccountDoc: matureAccountDoc,
      toAccount: receiverAccount1._id,
      amount: 100
    });

    console.log(`Risk Score: ${risk.riskScore}, Status: ${risk.riskStatus}, Reasons: ${JSON.stringify(risk.riskReasons)}`);
    if (
      risk.riskReasons.includes("VERY_HIGH_TRANSACTION_VELOCITY") ||
      risk.riskReasons.includes("HIGH_TRANSACTION_VELOCITY")
    ) {
      console.log("✓ TEST 4 PASSED: HIGH/VERY_HIGH_TRANSACTION_VELOCITY triggered\n");
    } else {
      throw new Error(`Expected velocity reason in ${JSON.stringify(risk.riskReasons)}`);
    }
  } catch (err) {
    console.error("✗ TEST 4 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 5: Multiple risk rules triggered
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 5: Multiple risk rules triggered ---");
    const newAccountDoc = {
      _id: senderAccount._id,
      createdAt: new Date() // Brand new account
    };

    // Amount = 15,000 (HIGH_AMOUNT: +20), to receiverAccount2 (FIRST_TIME: +20), NEW_ACCOUNT (+10), Velocity (+40)
    const risk = await riskEngineService.calculateTransactionRisk({
      user: senderUser,
      fromAccount: senderAccount._id,
      fromAccountDoc: newAccountDoc,
      toAccount: receiverAccount2._id,
      amount: 15000
    });

    console.log(`Risk Score: ${risk.riskScore}, Status: ${risk.riskStatus}, Reasons: ${JSON.stringify(risk.riskReasons)}`);
    if (risk.riskReasons.length >= 3 && risk.riskScore >= 60) {
      console.log(`✓ TEST 5 PASSED: ${risk.riskReasons.length} rules triggered, combined score = ${risk.riskScore}\n`);
    } else {
      throw new Error(`Expected >= 3 reasons and score >= 60, got ${risk.riskReasons.length} reasons, score ${risk.riskScore}`);
    }
  } catch (err) {
    console.error("✗ TEST 5 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 6: Score cap (Never exceed 100)
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 6: Score cap ---");
    // Trigger VERY_HIGH_AMOUNT (35) + VERY_HIGH_VELOCITY (40) + FIRST_TIME (20) + NEW_ACCOUNT (10) + UNUSUAL_AMOUNT (15) = 120
    const newAccountDoc = {
      _id: senderAccount._id,
      createdAt: new Date()
    };

    const risk = await riskEngineService.calculateTransactionRisk({
      user: senderUser,
      fromAccount: senderAccount._id,
      fromAccountDoc: newAccountDoc,
      toAccount: receiverAccount2._id,
      amount: 60000 // VERY_HIGH_AMOUNT + UNUSUAL
    });

    console.log(`Raw rules triggered: ${risk.riskReasons.join(", ")}`);
    console.log(`Calculated Score: ${risk.riskScore} (Must be exactly <= 100)`);
    if (risk.riskScore === 100) {
      console.log("✓ TEST 6 PASSED: Score correctly capped at 100\n");
    } else {
      throw new Error(`Expected score to cap at 100, got ${risk.riskScore}`);
    }
  } catch (err) {
    console.error("✗ TEST 6 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 7: Existing normal transfer via API
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 7: Existing normal transfer via API ---");
    const balBeforeSender = await senderAccount.getBalance();
    const balBeforeRecv = await receiverAccount1.getBalance();

    const idempotencyKey = `normal_api_${testSuffix}`;
    const res = await fetch(`${BASE_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${senderToken}`
      },
      body: JSON.stringify({
        fromAccount: senderAccount._id.toString(),
        toAccount: receiverAccount1._id.toString(),
        amount: 250,
        idempotencyKey
      })
    });

    const body = await res.json();
    console.log(`API Status: ${res.status}, Response:`, JSON.stringify(body));

    if (res.status !== 201) {
      throw new Error(`Expected 201, got ${res.status}: ${JSON.stringify(body)}`);
    }

    const balAfterSender = await senderAccount.getBalance();
    const balAfterRecv = await receiverAccount1.getBalance();

    console.log(`Sender balance: ${balBeforeSender} -> ${balAfterSender} (diff: ${balBeforeSender - balAfterSender})`);
    console.log(`Receiver balance: ${balBeforeRecv} -> ${balAfterRecv} (diff: ${balAfterRecv - balBeforeRecv})`);

    const debitEntry = await ledgerModel.findOne({ transaction: body.transaction.id, type: "DEBIT" });
    const creditEntry = await ledgerModel.findOne({ transaction: body.transaction.id, type: "CREDIT" });

    if (balBeforeSender - balAfterSender !== 250 || balAfterRecv - balBeforeRecv !== 250) {
      throw new Error("Balance change mismatch");
    }

    if (!debitEntry || !creditEntry) {
      throw new Error("Missing DEBIT or CREDIT ledger entry");
    }

    // Security check: ensure riskScore, riskReasons are NOT exposed in user response
    if (body.transaction.riskScore !== undefined || body.transaction.riskReasons !== undefined) {
      throw new Error("Security violation: riskScore or riskReasons leaked in response!");
    }

    console.log("✓ TEST 7 PASSED: Normal transfer debits sender, credits receiver, creates double-entry ledger, hides risk fields\n");
  } catch (err) {
    console.error("✗ TEST 7 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 8: Blocked transaction (Extreme risk)
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 8: Blocked transaction ---");
    // Create a new user & account with brand new timestamp and send ₹75,000 to a brand new beneficiary
    const blockedUser = await userModel.create({
      name: `Blocked User ${testSuffix}`,
      email: `blocked_${testSuffix}@example.com`,
      password: "Password123!"
    });

    const blockedAccount = await accountModel.create({
      user: blockedUser._id,
      currency: "INR",
      status: "ACTIVE"
    });

    // Seed ₹1,00,000
    const seedBlk = await transactionModel.create({
      fromAccount: blockedAccount._id,
      toAccount: blockedAccount._id,
      amount: 100000,
      status: "COMPLETED",
      idempotencyKey: `seed_blk_${testSuffix}`
    });
    await ledgerModel.create({
      account: blockedAccount._id,
      amount: 100000,
      transaction: seedBlk._id,
      type: "CREDIT"
    });

    // Flood 3 rapid transactions to generate velocity
    for (let k = 1; k <= 3; k++) {
      await transactionModel.create({
        fromAccount: blockedAccount._id,
        toAccount: receiverAccount1._id,
        amount: 10,
        status: "COMPLETED",
        idempotencyKey: `vel_blk_${testSuffix}_${k}`,
        createdAt: new Date()
      });
    }

    const blockedToken = generateAuthToken(blockedUser);
    const balBefore = await blockedAccount.getBalance();
    const idempotencyKey = `blk_api_${testSuffix}`;

    // Transfer ₹60,000 to brand new receiverAccount2:
    // VERY_HIGH_AMOUNT (35) + VERY_HIGH_VELOCITY (40) + FIRST_TIME (20) + NEW_ACCOUNT (10) = 105 -> capped at 100 (BLOCKED)
    const res = await fetch(`${BASE_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${blockedToken}`
      },
      body: JSON.stringify({
        fromAccount: blockedAccount._id.toString(),
        toAccount: receiverAccount2._id.toString(),
        amount: 60000,
        idempotencyKey
      })
    });

    const body = await res.json();
    console.log(`API Status: ${res.status}, Response:`, JSON.stringify(body));

    if (res.status !== 403) {
      throw new Error(`Expected 403 for BLOCKED transaction, got ${res.status}`);
    }

    const balAfter = await blockedAccount.getBalance();
    if (balBefore !== balAfter) {
      throw new Error(`Balance changed on blocked transaction! Before: ${balBefore}, After: ${balAfter}`);
    }

    // Verify transaction record was created with FAILED status and riskStatus BLOCKED
    const recordedTx = await transactionModel.findOne({ idempotencyKey });
    if (!recordedTx) {
      throw new Error("Failed transaction was not recorded for audit trail");
    }

    console.log(`Recorded Audit Tx: status=${recordedTx.status}, riskStatus=${recordedTx.riskStatus}, riskScore=${recordedTx.riskScore}, reasons=${recordedTx.riskReasons.join(",")}`);

    // Verify NO ledger entries exist for this transaction
    const ledgers = await ledgerModel.find({ transaction: recordedTx._id });
    if (ledgers.length > 0) {
      throw new Error(`Ledger entries found for blocked transaction! Count: ${ledgers.length}`);
    }

    console.log("✓ TEST 8 PASSED: Blocked transaction prevented ledger writes, preserved balance, returned safe message\n");
  } catch (err) {
    console.error("✗ TEST 8 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 9: Idempotency with risk calculation
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 9: Idempotency with risk engine ---");
    const idempotencyKey = `idemp_${testSuffix}`;

    const res1 = await fetch(`${BASE_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${senderToken}`
      },
      body: JSON.stringify({
        fromAccount: senderAccount._id.toString(),
        toAccount: receiverAccount1._id.toString(),
        amount: 150,
        idempotencyKey
      })
    });
    const body1 = await res1.json();

    const balMid = await senderAccount.getBalance();

    // Re-submit identical request with same idempotencyKey
    const res2 = await fetch(`${BASE_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${senderToken}`
      },
      body: JSON.stringify({
        fromAccount: senderAccount._id.toString(),
        toAccount: receiverAccount1._id.toString(),
        amount: 150,
        idempotencyKey
      })
    });
    const body2 = await res2.json();

    const balFinal = await senderAccount.getBalance();

    console.log(`First call status: ${res1.status}, Second call status: ${res2.status}`);
    console.log(`Balance after call 1: ${balMid}, Balance after call 2: ${balFinal}`);

    if (balMid !== balFinal) {
      throw new Error(`Double-spend occurred! Mid: ${balMid}, Final: ${balFinal}`);
    }

    if (body1.transaction.id !== body2.transaction.id) {
      throw new Error("Transaction ID mismatch on idempotent replay");
    }

    console.log("✓ TEST 9 PASSED: Idempotent replay safely returned without duplicate ledger debit\n");
  } catch (err) {
    console.error("✗ TEST 9 FAILED:", err.message, "\n");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 10: Concurrency protection
  // -------------------------------------------------------------
  try {
    console.log("--- TEST 10: Concurrency protection ---");
    // Create dedicated sender and receiver accounts for concurrency verification
    const concUser = await userModel.create({
      name: `Conc User ${testSuffix}`,
      email: `conc_${testSuffix}@example.com`,
      password: "Password123!"
    });

    const concSenderAccount = await accountModel.create({
      user: concUser._id,
      currency: "INR",
      status: "ACTIVE"
    });

    const concReceiverAccount = await accountModel.create({
      user: receiverUser1._id,
      currency: "INR",
      status: "ACTIVE"
    });

    // Seed ₹1,000 initial balance to concSenderAccount
    const concSeedTx = await transactionModel.create({
      fromAccount: concSenderAccount._id,
      toAccount: concSenderAccount._id,
      amount: 1000,
      status: "COMPLETED",
      idempotencyKey: `conc_seed_${testSuffix}`
    });
    await ledgerModel.create({
      account: concSenderAccount._id,
      amount: 1000,
      transaction: concSeedTx._id,
      type: "CREDIT"
    });

    // Establish prior beneficiary relationship so beneficiary score is 0
    await transactionModel.create({
      fromAccount: concSenderAccount._id,
      toAccount: concReceiverAccount._id,
      amount: 10,
      status: "COMPLETED",
      idempotencyKey: `conc_prior_${testSuffix}`
    });

    const concToken = generateAuthToken(concUser);
    const curBal = await concSenderAccount.getBalance();
    const targetAmount = 600; // 600 each when balance is 1000

    console.log(`Current Balance: ₹${curBal}. Attempting two concurrent transfers of ₹${targetAmount} each.`);

    const key1 = `conc_1_${testSuffix}`;
    const key2 = `conc_2_${testSuffix}`;

    const [resA, resB] = await Promise.all([
      fetch(`${BASE_URL}/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${concToken}`
        },
        body: JSON.stringify({
          fromAccount: concSenderAccount._id.toString(),
          toAccount: concReceiverAccount._id.toString(),
          amount: targetAmount,
          idempotencyKey: key1
        })
      }),
      fetch(`${BASE_URL}/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${concToken}`
        },
        body: JSON.stringify({
          fromAccount: concSenderAccount._id.toString(),
          toAccount: concReceiverAccount._id.toString(),
          amount: targetAmount,
          idempotencyKey: key2
        })
      })
    ]);

    const statusA = resA.status;
    const statusB = resB.status;
    const bodyA = await resA.json();
    const bodyB = await resB.json();
    const endBal = await concSenderAccount.getBalance();

    console.log(`Result: Request A status=${statusA} (${bodyA.message}), Request B status=${statusB} (${bodyB.message})`);
    console.log(`Ending Balance: ₹${endBal}`);

    // Exactly one should succeed (201) and one should fail (400 insufficient balance)
    const successCount = (statusA === 201 ? 1 : 0) + (statusB === 201 ? 1 : 0);
    if (successCount === 1 && endBal === curBal - targetAmount) {
      console.log("✓ TEST 10 PASSED: Concurrency anchor correctly serialized transactions and prevented double-spend\n");
    } else {
      throw new Error(`Unexpected concurrency outcome: successCount=${successCount}, endBal=${endBal}`);
    }
  } catch (err) {
    console.error("✗ TEST 10 FAILED:", err.message, "\n");
    allPassed = false;
  }

  await mongoose.disconnect();

  console.log("==========================================================");
  if (allPassed) {
    console.log("       ALL 10 RISK & FRAUD ENGINE TESTS PASSED!           ");
  } else {
    console.log("       SOME TESTS FAILED! PLEASE REVIEW OUTPUT.           ");
  }
  console.log("==========================================================");
}

runTestSuite().catch(err => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
