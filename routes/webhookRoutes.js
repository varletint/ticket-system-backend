const express = require("express");
const router = express.Router();
const webhookController = require("../controllers/webhookController");

// Paystack webhook endpoint
// POST /api/webhooks/paystack
router.post("/paystack", webhookController.handlePaystackWebhook);

// Health check for webhook endpoint
// GET /api/webhooks/health
router.get("/health", webhookController.healthCheck);

module.exports = router;
