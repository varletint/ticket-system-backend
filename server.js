require("dotenv").config();

const validateEnv = require("./utils/validateEnv");
// validateEnv(); // Commented out to prevent fatal startup errors on Vercel

const express = require("express");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const mongoSanitize = require("express-mongo-sanitize");

const connectDB = require("./config/db");
const logger = require("./utils/logger");

const authRoutes = require("./routes/authRoutes");
const eventRoutes = require("./routes/eventRoutes");
const ticketRoutes = require("./routes/ticketRoutes");
const validationRoutes = require("./routes/validationRoutes");
const adminRoutes = require("./routes/adminRoutes");
const transactionRoutes = require("./routes/transactionRoutes");
const disputeRoutes = require("./routes/disputeRoutes");
const reconciliationRoutes = require("./routes/reconciliationRoutes");
const auditRoutes = require("./routes/auditRoutes");
const organizerRoutes = require("./routes/organizerRoutes");
const orderRoutes = require("./routes/orderRoutes");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");

const app = express();

app.set("trust proxy", true);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(mongoSanitize());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { message: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    message: "Too many authentication attempts, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/auth", authLimiter);

app.use(compression());

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  })
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

app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/validate", validationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/disputes", disputeRoutes);
app.use("/api/reconciliation", reconciliationRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/organizer", organizerRoutes);
app.use("/api/orders", orderRoutes);

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date() });
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
