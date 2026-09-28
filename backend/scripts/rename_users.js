const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const userModel = require("../src/models/user.model");

const FIRST_10_PROFILES = [
  { name: "Ritu Raj", email: "riturajsainkanti@gmail.com" },
  { name: "Vikram Malhotra", email: "vikram.malhotra@bankledger.com" },
  { name: "Priya Sharma", email: "priya.sharma@bankledger.com" },
  { name: "Rahul Verma", email: "rahul.verma@bankledger.com" },
  { name: "System Operator", email: "system.operator@bankledger.internal" },
  { name: "Alice Banker", email: "alice.banker@bankledger.com" },
  { name: "Bob Receiver", email: "bob.receiver@bankledger.com" },
  { name: "Kavita Patel", email: "kavita.patel@bankledger.com" },
  { name: "Ananya Rao", email: "ananya.rao@bankledger.com" },
  { name: "Abhay Raj", email: "abhayraj@gmail.com" } // Main Admin
];

const LAST_10_PROFILES = [
  { name: "Siddharth Gupta", email: "siddharth.gupta@bankledger.com" },
  { name: "Meera Nair", email: "meera.nair@bankledger.com" },
  { name: "Rohan Joshi", email: "rohan.joshi@bankledger.com" },
  { name: "Deepak Reddy", email: "deepak.reddy@bankledger.com" },
  { name: "Neha Kapoor", email: "neha.kapoor@bankledger.com" },
  { name: "Compliance Admin", email: "compliance.admin@bankledger.internal" }, // ADMIN
  { name: "Arjun Sen", email: "arjun.sen@bankledger.com" },
  { name: "Pooja Iyer", email: "pooja.iyer@bankledger.com" },
  { name: "DevOps Operations", email: "devops@bankledger.internal" },
  { name: "Security Operations Admin", email: "security.admin@bankledger.internal" } // ADMIN
];

async function renameSelectedUsers() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB Atlas.");

  // Fetch 1st 10 users by createdAt ASC
  const first10 = await userModel.find().sort({ createdAt: 1 }).limit(10);
  console.log("\nUpdating First 10 Users:");
  for (let i = 0; i < first10.length; i++) {
    const user = first10[i];
    const profile = FIRST_10_PROFILES[i];
    const oldName = user.name;
    const oldEmail = user.email;

    // Check if new email is taken by another user
    const existing = await userModel.findOne({ email: profile.email, _id: { $ne: user._id } });
    if (!existing) {
      user.name = profile.name;
      user.email = profile.email;
      await user.save();
      console.log(`  [${i + 1}] [${user.role}] "${oldName}" <${oldEmail}> -> "${user.name}" <${user.email}>`);
    } else {
      user.name = profile.name;
      await user.save();
      console.log(`  [${i + 1}] [${user.role}] "${oldName}" -> "${user.name}" (email ${oldEmail} preserved)`);
    }
  }

  // Fetch Last 10 users by createdAt DESC
  const last10 = await userModel.find().sort({ createdAt: -1 }).limit(10);
  console.log("\nUpdating Last 10 Users:");
  for (let i = 0; i < last10.length; i++) {
    const user = last10[i];
    const profile = LAST_10_PROFILES[i];
    const oldName = user.name;
    const oldEmail = user.email;

    const existing = await userModel.findOne({ email: profile.email, _id: { $ne: user._id } });
    if (!existing) {
      user.name = profile.name;
      user.email = profile.email;
      await user.save();
      console.log(`  [${i + 1}] [${user.role}] "${oldName}" <${oldEmail}> -> "${user.name}" <${user.email}>`);
    } else {
      user.name = profile.name;
      await user.save();
      console.log(`  [${i + 1}] [${user.role}] "${oldName}" -> "${user.name}" (email ${oldEmail} preserved)`);
    }
  }

  console.log("\nFinished renaming 1st 10 and last 10 users successfully.");
  await mongoose.disconnect();
}

renameSelectedUsers().catch(err => {
  console.error("Renaming error:", err);
  process.exit(1);
});
