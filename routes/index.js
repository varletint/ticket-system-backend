const express = require("express");
const router = express.Router();

const authRoutes = require("./authRoutes");
const eventRoutes = require("./eventRoutes");
const ticketRoutes = require("./ticketRoutes");
const validationRoutes = require("./validationRoutes");
const adminRoutes = require("./adminRoutes");
const transactionRoutes = require("./transactionRoutes");
const disputeRoutes = require("./disputeRoutes");
const reconciliationRoutes = require("./reconciliationRoutes");
const auditRoutes = require("./auditRoutes");
const organizerRoutes = require("./organizerRoutes");
const orderRoutes = require("./orderRoutes");

router.use("/auth", authRoutes);
router.use("/events", eventRoutes);
router.use("/tickets", ticketRoutes);
router.use("/validate", validationRoutes);
router.use("/admin", adminRoutes);
router.use("/transactions", transactionRoutes);
router.use("/disputes", disputeRoutes);
router.use("/reconciliation", reconciliationRoutes);
router.use("/audit", auditRoutes);
router.use("/organizer", organizerRoutes);
router.use("/orders", orderRoutes);

module.exports = router;
