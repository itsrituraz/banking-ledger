const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const dns = require("dns");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const userModel = require("../src/models/user.model");
const accountModel = require("../src/models/account.model");

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--promote" && args[i + 1]) {
      parsed.promote = args[i + 1].trim();
      i++;
    } else if (args[i] === "--create") {
      parsed.create = true;
    } else if (args[i] === "--email" && args[i + 1]) {
      parsed.email = args[i + 1].trim();
      i++;
    } else if (args[i] === "--name" && args[i + 1]) {
      parsed.name = args[i + 1].trim();
      i++;
    } else if (args[i] === "--password" && args[i + 1]) {
      parsed.password = args[i + 1];
      i++;
    }
  }
  return parsed;
}

async function main() {
  const args = parseArgs();

  const emailToPromote = args.promote || (!args.create && process.env.ADMIN_EMAIL);
  const isCreate = args.create || (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD && !args.promote);

  if (!emailToPromote && !isCreate) {
    console.log(`
Usage:
  1. Promote existing user to ADMIN:
     node backend/scripts/createAdmin.js --promote <user_email>

  2. Create a new ADMIN user:
     node backend/scripts/createAdmin.js --create --email <email> --name <name> --password <password>

  3. Environment variable mode:
     ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=Secret ADMIN_NAME=Admin node backend/scripts/createAdmin.js
    `);
    process.exit(1);
  }

  if (!process.env.MONGO_URI) {
    console.error("Error: MONGO_URI is not set in environment or .env file.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB database.");

  try {
    if (emailToPromote && !args.create) {
      // Promotion mode
      const normalizedEmail = emailToPromote.toLowerCase().trim();
      const user = await userModel.findOne({ email: normalizedEmail });

      if (!user) {
        console.error(`Error: User with email "${normalizedEmail}" not found.`);
        process.exit(1);
      }

      if (user.role === "ADMIN") {
        console.log(`User "${normalizedEmail}" is already an ADMIN. No change needed.`);
      } else {
        user.role = "ADMIN";
        await user.save();
        console.log(`Success: User "${normalizedEmail}" has been promoted to ADMIN.`);
      }
    } else {
      // Creation mode
      const targetEmail = (args.email || process.env.ADMIN_EMAIL || "").toLowerCase().trim();
      const targetName = (args.name || process.env.ADMIN_NAME || "System Admin").trim();
      const targetPassword = args.password || process.env.ADMIN_PASSWORD;

      if (!targetEmail || !targetPassword) {
        console.error("Error: Email and password are required for creating an admin account.");
        process.exit(1);
      }

      if (targetPassword.length < 6) {
        console.error("Error: Password must be at least 6 characters.");
        process.exit(1);
      }

      let existing = await userModel.findOne({ email: targetEmail });
      if (existing) {
        if (existing.role === "ADMIN") {
          console.log(`Admin user "${targetEmail}" already exists. No change needed.`);
        } else {
          existing.role = "ADMIN";
          await existing.save();
          console.log(`Existing user "${targetEmail}" promoted to ADMIN.`);
        }
      } else {
        const adminUser = await userModel.create({
          email: targetEmail,
          password: targetPassword,
          name: targetName,
          role: "ADMIN"
        });

        await accountModel.create({
          user: adminUser._id,
          currency: "INR",
          status: "ACTIVE"
        });

        console.log(`Success: Created new ADMIN user "${targetEmail}" with Account ID.`);
      }
    }
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from database.");
  }
}

main().catch(err => {
  console.error("Admin provisioning error:", err.message);
  process.exit(1);
});
