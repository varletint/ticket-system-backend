const crypto = require("crypto");
const transactionService = require("./transactionService");
const auditService = require("./auditService");
const qrService = require("./qrService");
const Ticket = require("../models/Ticket");
const logger = require("../utils/logger");

/**
 * WebhookService
 * Handles Paystack webhook events with signature validation
 */
class WebhookService {
  constructor() {
    this.secretKey = process.env.PAYSTACK_SECRET_KEY;
  }

  /**
   * Validate Paystack webhook signature
   * Uses HMAC SHA512 to verify the request authenticity
   *
   * @param {string|Buffer} payload - Raw request body
   * @param {string} signature - x-paystack-signature header value
   * @returns {boolean} Whether signature is valid
   */
  validateSignature(payload, signature) {
    if (!this.secretKey) {
      logger.warn("PAYSTACK_SECRET_KEY not set, skipping signature validation");
      return false;
    }

    if (!signature) {
      logger.warn("No signature provided in webhook request");
      return false;
    }

    try {
      const hash = crypto
        .createHmac("sha512", this.secretKey)
        .update(payload)
        .digest("hex");

      const isValid = hash === signature;

      if (!isValid) {
        logger.warn("Webhook signature validation failed");
      }

      return isValid;
    } catch (error) {
      logger.error("Error validating webhook signature:", error);
      return false;
    }
  }

  /**
   * Process a Paystack webhook event
   * Routes to appropriate handler based on event type
   *
   * @param {Object} event - Paystack webhook event
   * @returns {Promise<Object>} Processing result
   */
  async processEvent(event) {
    const { event: eventType, data } = event;

    logger.info(`Processing Paystack webhook: ${eventType}`, {
      reference: data?.reference,
    });

    switch (eventType) {
      case "charge.success":
        return this.handleChargeSuccess(data);

      case "charge.failed":
        return this.handleChargeFailed(data);

      case "transfer.success":
        return this.handleTransferSuccess(data);

      case "transfer.failed":
        return this.handleTransferFailed(data);

      case "refund.processed":
        return this.handleRefundProcessed(data);

      default:
        logger.info(`Unhandled webhook event type: ${eventType}`);
        return { handled: false, eventType };
    }
  }

  /**
   * Handle successful charge event
   * Completes the transaction and generates tickets
   *
   * @param {Object} data - Charge data from Paystack
   * @returns {Promise<Object>} Processing result
   */
  async handleChargeSuccess(data) {
    const { reference } = data;

    try {
      // Find transaction by reference
      const transaction = await transactionService.findByReference(reference);

      if (!transaction) {
        logger.warn(`No transaction found for reference: ${reference}`);
        return { handled: false, reason: "Transaction not found" };
      }

      // Skip if already completed
      if (transaction.status === "completed") {
        logger.info(`Transaction already completed: ${transaction._id}`);
        return { handled: true, skipped: true, reason: "Already completed" };
      }

      // Define ticket generator function
      const ticketGenerator = async (order, event, user, session) => {
        const tickets = [];

        for (let i = 0; i < order.quantity; i++) {
          const tempId = `${order._id}_${i}_${Date.now()}`;
          const qrToken = qrService.generateTicketToken(tempId, event._id);

          const [ticket] = await Ticket.create(
            [
              {
                order: order._id,
                event: event._id,
                user: order.user,
                tierName: order.tierName,
                tierId: order.tierId,
                price: order.unitPrice,
                qrCode: qrToken,
              },
            ],
            { session }
          );

          tickets.push(ticket);
        }

        return tickets;
      };

      // Complete transaction using the service
      const result = await transactionService.completeTransaction(
        transaction._id,
        data,
        ticketGenerator
      );

      await auditService.logTransaction(
        "transaction.webhook_complete",
        result.transaction,
        null,
        { source: "webhook", reference }
      );

      logger.info(`Webhook completed transaction: ${transaction._id}`, {
        ticketCount: result.tickets.length,
      });

      return {
        handled: true,
        transactionId: transaction._id,
        ticketCount: result.tickets.length,
      };
    } catch (error) {
      logger.error(`Error handling charge.success webhook:`, {
        reference,
        error: error.message,
      });

      // Log the error but don't throw - webhooks should return 200
      await auditService.logError(error, {
        context: "webhook.charge.success",
        reference,
      });

      return { handled: false, error: error.message };
    }
  }

  /**
   * Handle failed charge event
   * Marks the transaction as failed
   *
   * @param {Object} data - Charge data from Paystack
   * @returns {Promise<Object>} Processing result
   */
  async handleChargeFailed(data) {
    const { reference, gateway_response } = data;

    try {
      const transaction = await transactionService.findByReference(reference);

      if (!transaction) {
        logger.warn(`No transaction found for reference: ${reference}`);
        return { handled: false, reason: "Transaction not found" };
      }

      // Skip if already failed or completed
      if (["failed", "completed"].includes(transaction.status)) {
        logger.info(
          `Transaction already in final state: ${transaction.status}`
        );
        return { handled: true, skipped: true };
      }

      // Fail the transaction
      await transactionService.failTransaction(transaction._id, {
        reason: gateway_response || "Payment failed",
        code: data.status,
        details: { source: "webhook", data },
      });

      await auditService.logTransaction(
        "transaction.webhook_fail",
        transaction,
        null,
        { source: "webhook", reference, gateway_response }
      );

      logger.info(`Webhook failed transaction: ${transaction._id}`);

      return { handled: true, transactionId: transaction._id };
    } catch (error) {
      logger.error(`Error handling charge.failed webhook:`, {
        reference,
        error: error.message,
      });

      return { handled: false, error: error.message };
    }
  }

  /**
   * Handle successful transfer event (for organizer payouts)
   * @param {Object} data - Transfer data from Paystack
   */
  async handleTransferSuccess(data) {
    logger.info("Transfer success webhook received", {
      reference: data.reference,
      amount: data.amount,
    });

    // Future: Implement payout tracking
    return { handled: true, type: "transfer.success" };
  }

  /**
   * Handle failed transfer event
   * @param {Object} data - Transfer data from Paystack
   */
  async handleTransferFailed(data) {
    logger.warn("Transfer failed webhook received", {
      reference: data.reference,
      reason: data.reason,
    });

    // Future: Implement payout failure handling
    return { handled: true, type: "transfer.failed" };
  }

  /**
   * Handle refund processed event
   * @param {Object} data - Refund data from Paystack
   */
  async handleRefundProcessed(data) {
    logger.info("Refund processed webhook received", {
      reference: data.transaction_reference,
      amount: data.amount,
    });

    // Future: Update refund status from Paystack
    return { handled: true, type: "refund.processed" };
  }
}

// Export singleton instance
module.exports = new WebhookService();
