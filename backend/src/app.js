const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const helmet = require("helmet");

const requestIdMiddleware = require("./middleware/requestId.middleware");
const requestLoggerMiddleware = require("./middleware/requestLogger.middleware");
const { apiLimiter } = require("./middleware/rateLimiter.middleware");
const logger = require("./utils/logger");

const app = express();

// 1. Trust Proxy Configuration (for production reverse proxies, e.g. Nginx, Cloudflare)
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : process.env.TRUST_PROXY);
}

// 2. Security Headers (Helmet)
// Hardens HTTP response headers while preserving compatibility with Vite/React frontend
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: process.env.NODE_ENV === "production" ? undefined : false
  })
);

// 3. CORS Configuration with strict origin validation
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",").map(url => url.trim())
  : ["http://localhost:5173", "http://127.0.0.1:5173"];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (server-to-server, mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1) {
        return callback(null, true);
      } else {
        return callback(new Error("CORS: Not allowed by policy"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id", "Idempotency-Key"]
  })
);

// 4. Request Body & Payload Bounds (50kb limit prevents payload exhaustion / DoS)
app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: true, limit: "50kb" }));

// 5. Cookie Parser & Request Correlation ID & Lifecycle Logging
app.use(cookieParser());
app.use(requestIdMiddleware);
app.use(requestLoggerMiddleware);

const mongoose = require("mongoose");

// Unauthenticated Liveness & Readiness Probes (Load Balancer & Monitoring Friendly)
app.get("/health", (req, res) => {
  return res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString()
  });
});

app.get("/health/ready", (req, res) => {
  const isDbConnected = mongoose.connection.readyState === 1;
  if (isDbConnected) {
    return res.status(200).json({
      status: "ready",
      database: "connected"
    });
  } else {
    return res.status(503).json({
      status: "unavailable",
      database: "disconnected"
    });
  }
});

// 6. Global API Rate Limiter
app.use("/api", apiLimiter);

// 7. Route Mounts
const authRouter = require("./routes/auth.routes");
const accountRouter = require("./routes/account.routes");
const transactionRoutes = require("./routes/transaction.routes");
const adminRoutes = require("./routes/admin.routes");

app.use("/api/auth", authRouter);
app.use("/api/accounts", accountRouter);
app.use("/api/transactions", transactionRoutes);
app.use("/api/admin", adminRoutes);

// 8. 404 Handler for undefined routes
app.use((req, res) => {
  return res.status(404).json({ message: "Endpoint not found" });
});

// 9. Centralized Error Handler (Information Disclosure Protection + Structured Error Observability)
app.use((err, req, res, next) => {
  const statusCode = err.status || (err.type === "entity.too.large" ? 413 : (err.type === "entity.parse.failed" ? 400 : 500));
  const errorType = err.name || "Error";

  // Structured operational error log (SERVER-SIDE ONLY - stack trace never sent to client)
  logger.error("ERROR", {
    requestId: req.requestId || "UNKNOWN",
    method: req.method,
    path: req.originalUrl || req.url,
    statusCode,
    errorType,
    message: err.message,
    stack: err.stack
  });

  // Handle CORS rejection
  if (err.message && err.message.includes("CORS")) {
    return res.status(403).json({ message: "Origin not allowed by CORS policy" });
  }

  // Handle malformed JSON body
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Malformed JSON payload" });
  }

  // Handle payload too large
  if (err.type === "entity.too.large" || err.status === 413) {
    return res.status(413).json({ message: "Request payload exceeds allowed limit of 50kb" });
  }

  return res.status(statusCode).json({
    message: "Internal server error. Please try again later."
  });
});

module.exports = app;