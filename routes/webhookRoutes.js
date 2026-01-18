const express = require("express");
const router = express.Router();
const webhookController = require("../controllers/webhookController");

router.post("/paystack", webhookController.handlePaystackWebhook);

router.get("/health", webhookController.healthCheck);

module.exports = router;
