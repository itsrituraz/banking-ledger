require("dotenv").config();

const dns = require("dns");

dns.setServers([
    "8.8.8.8",
    "1.1.1.1"
]);

const mongoose = require("mongoose");
const userModel = require("./models/user.model");

async function createSystemUser() {

    await mongoose.connect(process.env.MONGO_URI);

    const existingUser = await userModel
        .findOne({ email: "system@bank.com" })
        .select("+systemUser");

    if (existingUser) {
        console.log("System user already exists");
        await mongoose.disconnect();
        return;
    }

    const user = await userModel.create({
        email: "system@bank.com",
        name: "System User",
        password: "System@123",
        systemUser: true
    });

    console.log("System user created:", user._id);

    await mongoose.disconnect();
}

createSystemUser();