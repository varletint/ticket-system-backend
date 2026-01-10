const webhookService = require("../services/webhookService");
const logger = require("../utils/logger");

/**
 * Webhook Controller
 * Handles incoming webhook requests from payment providers
 */

/**
 * Handle Paystack webhook
 * POST /api/webhooks/paystack
 */
const handlePaystackWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-paystack-signature"];
    const rawBody = req.rawBody || JSON.stringify(req.body);

    const isValid = webhookService.validateSignature(rawBody, signature);

    if (!isValid) {
      logger.warn("Invalid Paystack webhook signature", {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(200).json({
        success: false,
        message: "Invalid signature",
      });
    }

    const event = req.body;

    if (!event || !event.event) {
      return res.status(200).json({
        success: false,
        message: "Invalid event format",
      });
    }

    // Process the event
    const result = await webhookService.processEvent(event);

    logger.info("Paystack webhook processed", {
      eventType: event.event,
      reference: event.data?.reference,
      handled: result.handled,
    });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error("Error processing Paystack webhook:", {
      error: error.message,
      stack: error.stack,
    });

    res.status(200).json({
      success: false,
      message: "Webhook processing error",
    });
  }
};

/**
 * Webhook health check
 * GET /api/webhooks/health
 */
const healthCheck = async (req, res) => {
  res.json({
    success: true,
    message: "Webhook endpoint is healthy",
    timestamp: new Date().toISOString(),
  });
};

module.exports = {
  handlePaystackWebhook,
  healthCheck,
};
