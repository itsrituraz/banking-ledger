const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const userModel = require("../src/models/user.model");

async function inspect() {
  await mongoose.connect(process.env.MONGO_URI);
  const total = await userModel.countDocuments();
  console.log("Total users:", total);

  const first10 = await userModel.find().sort({ createdAt: 1 }).limit(10);
  console.log("\n--- FIRST 10 USERS (by createdAt asc) ---");
  first10.forEach((u, i) => console.log(`${i + 1}. [${u.role}] ${u.name} <${u.email}> (${u._id})`));

  const last10 = await userModel.find().sort({ createdAt: -1 }).limit(10);
  console.log("\n--- LAST 10 USERS (by createdAt desc) ---");
  last10.forEach((u, i) => console.log(`${i + 1}. [${u.role}] ${u.name} <${u.email}> (${u._id})`));

  const admins = await userModel.find({ role: "ADMIN" });
  console.log("\n--- ALL ADMIN USERS ---");
  admins.forEach(u => console.log(`[ADMIN] ${u.name} <${u.email}> (${u._id})`));

  await mongoose.disconnect();
}

inspect().catch(err => {
  console.error(err);
  process.exit(1);
});
