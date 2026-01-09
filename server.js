require("dotenv").config();

const express = require("express");
const connectDB = require("./config/db");

const authRoutes = require("./routes/authRoutes");
const eventRoutes = require("./routes/eventRoutes");
const ticketRoutes = require("./routes/ticketRoutes");
// const validationRoutes = require("./routes/validationRoutes");
// const adminRoutes = require("./routes/adminRoutes");
// const transactionRoutes = require("./routes/transactionRoutes");
// const disputeRoutes = require("./routes/disputeRoutes");
// const reconciliationRoutes = require("./routes/reconciliationRoutes");
// const auditRoutes = require("./routes/auditRoutes");
// const organizerRoutes = require("./routes/organizerRoutes");
// const orderRoutes = require("./routes/orderRoutes");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");
const app = express();

app.get("/", (req, res) => {
  res.send("Hello World!");
});

connectDB();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
