const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const mongoose = require("mongoose");

const validateEnv = require("./src/config/validateEnv");
const logger = require("./src/utils/logger");

// 1. Fail-fast production environment validation
validateEnv();

const app = require("./src/app");
const connectToDB = require("./src/config/db");

// 2. Connect to MongoDB database
connectToDB();

// 3. Bind to configured port (standard for cloud platforms like Render, AWS, Heroku)
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  logger.info("SERVER_INITIALIZED", {
    port: PORT,
    nodeEnv: process.env.NODE_ENV || "development",
    pid: process.pid
  });
  console.log(`Server is running on port ${PORT}`);
});

// 4. Graceful Shutdown Protocol (SIGTERM / SIGINT)
let isShuttingDown = false;

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.warn("GRACEFUL_SHUTDOWN_START", { signal, pid: process.pid });
  console.log(`\nReceived ${signal}. Initiating graceful shutdown...`);

  // Stop accepting new HTTP connections
  server.close(async (serverErr) => {
    if (serverErr) {
      logger.error("SERVER_CLOSE_ERROR", { message: serverErr.message });
      console.error("Error closing HTTP server:", serverErr.message);
    } else {
      logger.info("HTTP_SERVER_CLOSED", { message: "HTTP listener terminated. No new connections accepted." });
      console.log("HTTP server closed.");
    }

    // Close MongoDB connection pool cleanly
    try {
      await mongoose.connection.close(false);
      logger.info("DATABASE_DISCONNECTED_CLEANLY", { message: "MongoDB connection pool closed." });
      console.log("MongoDB connection closed.");
      process.exit(0);
    } catch (dbErr) {
      logger.error("DATABASE_CLOSE_ERROR", { message: dbErr.message });
      console.error("Error closing MongoDB connection:", dbErr.message);
      process.exit(1);
    }
  });

  // Force termination if active requests do not drain within 10 seconds
  const forceTimeout = setTimeout(() => {
    logger.error("GRACEFUL_SHUTDOWN_TIMEOUT", { message: "Forced shutdown: in-flight connections did not drain within 10 seconds." });
    console.error("Forceful shutdown: 10s timeout expired.");
    process.exit(1);
  }, 10000);

  if (forceTimeout.unref) forceTimeout.unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));