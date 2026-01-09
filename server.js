require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const connectDB = require("./config/db");

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

// connectDB();

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files (tickets PDFs)
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

// Mock checkout page (for testing without real Paystack)
app.get("/paystack-mock", (req, res) => {
  res.send(`
    <h1>Paystack Mock</h1>
    <p>This is a mock Paystack page for testing purposes</p>
    <button onclick="completePayment()">Pay Now</button>
    <script>
      function completePayment() {
        window.location.href = 'http://localhost:5173/payment/verify?reference=mock-reference';
      }
    </script>
  `);
});
app.get("/mock-checkout", (req, res) => {
  const { ref, amount } = req.query;
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Mock Checkout</title>
      <style>
        body { font-family: Arial; max-width: 400px; margin: 50px auto; padding: 20px; }
        .card { border: 1px solid #ddd; padding: 30px; border-radius: 8px; text-align: center; }
        .amount { font-size: 32px; color: #0ea5e9; margin: 20px 0; }
        button { background: #22c55e; color: white; border: none; padding: 15px 30px; border-radius: 6px; cursor: pointer; font-size: 16px; }
        button:hover { background: #16a34a; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>Mock Payment</h2>
        <p>Reference: ${ref}</p>
        <div class="amount">₦${(parseInt(amount) || 0).toLocaleString()}</div>
        <p>This is a test checkout page</p>
        <button onclick="completePayment()">Pay Now</button>
      </div>
      <script>
        function completePayment() {
          window.location.href = 'http://localhost:5173/payment/verify?reference=${ref}';
        }
      </script>
    </body>
    </html>
  `);
});

// Global Error Handler
app.use(errorHandler);

// 404 Not Found Handler
app.use(notFoundHandler);

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`
 Ticket System Server running on port ${PORT}
 Environment: ${process.env.NODE_ENV || "development"}
🔗 API: http://localhost:${PORT}/api
  `);
  });
};

startServer();
