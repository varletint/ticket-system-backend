require("dotenv").config();

const validateEnv = require("./utils/validateEnv");
validateEnv();

const express = require("express");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const mongoSanitize = require("express-mongo-sanitize");

const connectDB = require("./config/db");
const logger = require("./utils/logger");

const apiRoutes = require("./routes");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");

const app = express();

app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(mongoSanitize());

// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 100,
//   message: { message: "Too many requests, please try again later." },
//   standardHeaders: true,
//   legacyHeaders: false,
//   validate: { trustProxy: false },
// });
// app.use("/api/v1", limiter);

// const authLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 10,
//   message: {
//     message: "Too many authentication attempts, please try again later.",
//   },
//   standardHeaders: true,
//   legacyHeaders: false,
//   validate: { trustProxy: false },
// });
// app.use("/api/v1/auth", authLimiter);

app.use(compression());

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  })
);

// Webhook routes need raw body for signature validation
// Must be BEFORE express.json() middleware
const webhookRoutes = require("./routes/webhookRoutes");
app.use(
  "/api/v1/webhooks",
  express.raw({ type: "application/json" }),
  (req, res, next) => {
    if (req.body && Buffer.isBuffer(req.body)) {
      req.rawBody = req.body.toString("utf8");
      try {
        req.body = JSON.parse(req.rawBody);
      } catch (e) {
        req.body = {};
      }
    }
    next();
  },
  webhookRoutes
);

app.use(express.json({ limit: "10kb" })); // Limit body size
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

app.use((req, res, next) => {
  req.clientIp =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    req.ip?.replace(/^::ffff:/, "") ||
    req.connection?.remoteAddress?.replace(/^::ffff:/, "") ||
    "unknown";
  next();
});

app.use(logger.requestLogger);

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Ensure database connection before handling API requests
app.use("/api/v1", async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    res.status(503).json({
      success: false,
      message: "Database connection failed. Please try again.",
    });
  }
});

app.use("/api/v1", apiRoutes);

app.get("/api/v1/health", (req, res) => {
  res.json({
    status: "OK",
    version: "v1",
    timestamp: new Date(),
  });
});

// Global Error Handler
app.use(errorHandler);

// 404 Not Found Handler
app.use(notFoundHandler);

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();

    // Skip app.listen on Vercel
    if (process.env.VERCEL) {
      console.log("Running in Vercel environment - skipping app.listen()");
      return;
    }

    const server = app.listen(PORT, () => {
      console.log(`
 Ticket System Server
 Status: Running
 Env:    ${process.env.NODE_ENV || "development"}
 Port:   ${PORT}
 API:    http://localhost:${PORT}/api
      `);
    });

    // Graceful Shutdown
    const shutdown = (signal) => {
      console.log(`\nReceived ${signal}. Shutting down gracefully...`);
      server.close(() => {
        console.log("HTTP server closed.");
        const mongoose = require("mongoose");
        mongoose.connection.close(false, () => {
          console.log("Database connection closed.");
          process.exit(0);
        });
      });

      // Force close if it takes too long
      setTimeout(() => {
        console.error(
          "Could not close connections in time, forcefully shutting down"
        );
        process.exit(1);
      }, 10000);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
};

startServer();

module.exports = app;
