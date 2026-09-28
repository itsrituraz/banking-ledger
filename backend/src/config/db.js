const mongoose = require("mongoose");
const dns = require("dns");
const logger = require("../utils/logger");

dns.setServers([
  "8.8.8.8",
  "1.1.1.1"
]);

function connectToDB() {
  const options = {
    maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE || "50", 10),
    minPoolSize: parseInt(process.env.MONGO_MIN_POOL_SIZE || "10", 10),
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000
  };

  mongoose.connection.on("connected", () => {
    logger.info("DATABASE_CONNECTED", { message: "MongoDB connection established" });
  });

  mongoose.connection.on("error", (err) => {
    logger.error("DATABASE_ERROR", { message: err.message });
  });

  mongoose.connection.on("disconnected", () => {
    logger.warn("DATABASE_DISCONNECTED", { message: "MongoDB connection lost" });
  });

  return mongoose.connect(process.env.MONGO_URI, options)
    .then(() => {
      console.log("server is connected to DB");
    })
    .catch(err => {
      logger.error("DATABASE_CONNECTION_FATAL", { message: err.message });
      console.error("Error connecting to DB:", err.message);
      process.exit(1);
    });
}

module.exports = connectToDB;