const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const dns = require("dns");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const userModel = require("../src/models/user.model");
const accountModel = require("../src/models/account.model");
const transactionModel = require("../src/models/transaction.model");
const ledgerModel = require("../src/models/ledger.model");

const DEMO_USERS = [
  {
    name: "Alice Sharma",
    email: "alice@example.com",
    password: "Password123!",
    role: "USER",
    initialBalance: 50000
  },
  {
    name: "Bob Verma",
    email: "bob@example.com",
    password: "Password123!",
    role: "USER",
    initialBalance: 50000
  },
  {
    name: "Charlie Patel",
    email: "charlie@example.com",
    password: "Password123!",
    role: "USER",
    initialBalance: 50000
  },
  {
    name: "David Singh",
    email: "david@example.com",
    password: "Password123!",
    role: "USER",
    initialBalance: 50000
  },
  {
    name: "System Administrator",
    email: "admin@example.com",
    password: "AdminPass123!",
    role: "ADMIN",
    initialBalance: 100000
  }
];

async function setup() {
  console.log("Connecting to MongoDB Atlas...");
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected successfully.\n");

  const results = [];

  for (const item of DEMO_USERS) {
    let user = await userModel.findOne({ email: item.email });
    if (!user) {
      user = await userModel.create({
        name: item.name,
        email: item.email,
        password: item.password,
        role: item.role
      });
      console.log(`Created user: ${item.email}`);
    } else {
      user.name = item.name;
      user.password = item.password; // Triggers pre-save bcrypt hash
      user.role = item.role;
      await user.save();
      console.log(`Updated user password & role: ${item.email}`);
    }

    // Ensure account exists
    let account = await accountModel.findOne({ user: user._id });
    if (!account) {
      account = await accountModel.create({
        user: user._id,
        currency: "INR",
        status: "ACTIVE"
      });
      console.log(`Created account for: ${item.email}`);
    } else if (account.status !== "ACTIVE") {
      account.status = "ACTIVE";
      await account.save();
    }

    // Check balance
    const currentBalance = await account.getBalance();

    // If balance is low, fund the account
    if (currentBalance < 10000) {
      const fundAmount = item.initialBalance - currentBalance;
      const seedTx = await transactionModel.create({
        fromAccount: account._id,
        toAccount: account._id,
        amount: fundAmount,
        status: "COMPLETED",
        idempotencyKey: `demo_seed_${item.email.split("@")[0]}_${Date.now()}`,
        riskScore: 0,
        riskStatus: "APPROVED"
      });

      await ledgerModel.create({
        account: account._id,
        amount: fundAmount,
        type: "CREDIT",
        transaction: seedTx._id
      });
      console.log(`Funded account ${account._id} with ₹${fundAmount}`);
    }

    const finalBalance = await account.getBalance();

    results.push({
      name: item.name,
      email: item.email,
      password: item.password,
      role: item.role,
      accountId: account._id.toString(),
      balance: `₹${finalBalance.toLocaleString("en-IN")}`
    });
  }

  await mongoose.disconnect();

  console.log("\n==================================================================");
  console.log("            DEMO & TESTING CREDENTIALS READY                      ");
  console.log("==================================================================");
  console.table(results);
}

setup().catch(err => {
  console.error("Error setting up demo accounts:", err);
  process.exit(1);
});
