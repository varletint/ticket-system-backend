const mongoose = require("mongoose");
const Transaction = require("../models/Transaction");
const Order = require("../models/Order");
const Event = require("../models/Event");
const Ticket = require("../models/Ticket");
const logger = require("../utils/logger");

/**
 * Transaction State Machine
 * Defines valid state transitions for transactions
 */
const STATE_TRANSITIONS = {
  initiated: ["processing", "failed"],
  processing: ["completed", "failed"],
  completed: ["refunded", "partially_refunded"],
  failed: ["processing"], // retry allowed
  refunded: [],
  partially_refunded: ["refunded"],
};

/**
 * TransactionService
 * Handles all transaction operations with MongoDB session support for atomicity
 */
class TransactionService {
  /**
   * Validate if a state transition is allowed
   * @param {string} fromState - Current state
   * @param {string} toState - Target state
   * @returns {boolean} Whether transition is valid
   */
  validateStateTransition(fromState, toState) {
    const allowedTransitions = STATE_TRANSITIONS[fromState];
    if (!allowedTransitions) {
      logger.warn(`Unknown transaction state: ${fromState}`);
      return false;
    }
    return allowedTransitions.includes(toState);
  }

  /**
   * Execute a callback within a MongoDB transaction session
   * Provides automatic retry for transient errors and rollback on failure
   *
   * @param {Function} callback - Async function receiving (session) parameter
   * @param {Object} options - Transaction options
   * @returns {Promise<any>} Result from callback
   */
  async withTransaction(callback, options = {}) {
    const session = await mongoose.startSession();

    try {
      let result;

      await session.withTransaction(
        async () => {
          result = await callback(session);
        },
        {
          readPreference: "primary",
          readConcern: { level: "local" },
          writeConcern: { w: "majority" },
          ...options,
        }
      );

      return result;
    } catch (error) {
      logger.error("Transaction failed:", {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Generate a unique idempotency key
   * @param {string} userId - User ID
   * @param {string} eventId - Event ID
   * @param {string} tierId - Tier ID
   * @returns {string} Idempotency key
   */
  generateIdempotencyKey(userId, eventId, tierId) {
    const timestamp = Date.now();
    return `txn_${userId}_${eventId}_${tierId}_${timestamp}`;
  }

  /**
   * Generate a unique payment reference
   * @param {string} prefix - Reference prefix
   * @param {string} userId - User ID
   * @returns {string} Payment reference
   */
  generateReference(prefix = "order", userId) {
    return `${prefix}_${Date.now()}_${userId}`;
  }

  /**
   * Calculate exponential backoff delay for retries
   * @param {number} retryCount - Current retry attempt
   * @param {number} baseDelay - Base delay in ms (default 1000)
   * @param {number} maxDelay - Maximum delay in ms (default 30000)
   * @returns {number} Delay in milliseconds
   */
  calculateRetryDelay(retryCount, baseDelay = 1000, maxDelay = 30000) {
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
    // Add jitter (±10%) to prevent thundering herd
    const jitter = delay * 0.1 * (Math.random() * 2 - 1);
    return Math.floor(delay + jitter);
  }

  /**
   * Check if a transaction can be retried
   * @param {Object} transaction - Transaction document
   * @returns {Object} { canRetry: boolean, reason?: string }
   */
  canRetry(transaction) {
    if (transaction.status !== "failed") {
      return {
        canRetry: false,
        reason: "Only failed transactions can be retried",
      };
    }

    if (transaction.retryCount >= transaction.maxRetries) {
      return {
        canRetry: false,
        reason: `Maximum retry attempts (${transaction.maxRetries}) reached`,
      };
    }

    return { canRetry: true };
  }

  /**
   * Check if a transaction can be refunded
   * @param {Object} transaction - Transaction document
   * @param {number} amount - Refund amount (optional, defaults to full refund)
   * @returns {Object} { canRefund: boolean, reason?: string, maxRefundable?: number }
   */
  canRefund(transaction, amount = null) {
    if (!["completed", "partially_refunded"].includes(transaction.status)) {
      return {
        canRefund: false,
        reason: "Only completed transactions can be refunded",
      };
    }

    const netAmount = transaction.amount - transaction.totalRefunded;
    if (netAmount <= 0) {
      return {
        canRefund: false,
        reason: "Transaction has already been fully refunded",
      };
    }

    if (amount && amount > netAmount) {
      return {
        canRefund: false,
        reason: `Refund amount exceeds available balance. Maximum refundable: ₦${netAmount.toLocaleString()}`,
        maxRefundable: netAmount,
      };
    }

    return {
      canRefund: true,
      maxRefundable: netAmount,
    };
  }

  /**
   * Update transaction state with validation
   * @param {Object} transaction - Transaction document
   * @param {string} newState - Target state
   * @param {Object} session - MongoDB session (optional)
   * @returns {Promise<Object>} Updated transaction
   */
  async updateState(transaction, newState, session = null) {
    if (!this.validateStateTransition(transaction.status, newState)) {
      throw new Error(
        `Invalid state transition: ${transaction.status} → ${newState}`
      );
    }

    transaction.status = newState;

    // Set timestamp based on state
    const now = new Date();
    switch (newState) {
      case "processing":
        transaction.processingAt = now;
        break;
      case "completed":
        transaction.completedAt = now;
        break;
      case "failed":
        transaction.failedAt = now;
        break;
    }

    const saveOptions = session ? { session } : {};
    await transaction.save(saveOptions);

    logger.info(`Transaction ${transaction._id} state updated to ${newState}`);
    return transaction;
  }

  /**
   * Find existing transaction by idempotency key
   * @param {string} idempotencyKey - The idempotency key
   * @returns {Promise<Object|null>} Transaction or null
   */
  async findByIdempotencyKey(idempotencyKey) {
    return Transaction.findOne({ idempotencyKey }).populate("order");
  }

  /**
   * Find transaction by payment reference
   * @param {string} reference - Payment gateway reference
   * @returns {Promise<Object|null>} Transaction or null
   */
  async findByReference(reference) {
    return Transaction.findOne({ "gateway.reference": reference })
      .populate("order")
      .populate("user", "fullName email")
      .populate("event", "title");
  }

  // ============================================
  // PHASE 2: TRANSACTION OPERATIONS
  // ============================================

  /**
   * Initiate a new transaction with order creation
   * Creates Order and Transaction atomically within a MongoDB session
   *
   * @param {Object} data - Transaction data
   * @param {Object} data.user - User object with _id, email
   * @param {Object} data.event - Event object with populated organizer
   * @param {Object} data.tier - Ticket tier object
   * @param {number} data.quantity - Number of tickets
   * @param {string} data.idempotencyKey - Client-provided idempotency key
   * @param {Object} data.paymentResult - Paystack initialization result
   * @param {Object} data.metadata - Additional metadata (ipAddress, userAgent)
   * @returns {Promise<Object>} { order, transaction }
   */
  async initiateTransaction(data) {
    const {
      user,
      event,
      tier,
      quantity,
      idempotencyKey,
      paymentResult,
      metadata = {},
    } = data;

    const totalAmount = tier.price * quantity;
    const subaccountCode =
      event.organizer?.organizerProfile?.paystack?.subaccountCode;

    return this.withTransaction(async (session) => {
      // Create Order
      const [order] = await Order.create(
        [
          {
            user: user._id,
            event: event._id,
            tierName: tier.name,
            tierId: tier._id,
            quantity,
            unitPrice: tier.price,
            totalAmount,
            paymentStatus: "pending",
            paystack: {
              reference: paymentResult.data.reference,
            },
          },
        ],
        { session }
      );

      // Create Transaction
      const transactionKey =
        idempotencyKey ||
        this.generateIdempotencyKey(user._id, event._id, tier._id);

      const [transaction] = await Transaction.create(
        [
          {
            idempotencyKey: transactionKey,
            status: "initiated",
            user: user._id,
            order: order._id,
            event: event._id,
            amount: totalAmount,
            gateway: {
              provider: process.env.PAYSTACK_SECRET_KEY ? "paystack" : "mock",
              reference: paymentResult.data.reference,
            },
            splits: {
              organizerSubaccountCode: subaccountCode,
            },
            metadata: {
              ipAddress: metadata.ipAddress,
              userAgent: metadata.userAgent,
              tierName: tier.name,
              quantity,
            },
          },
        ],
        { session }
      );

      logger.info(`Transaction initiated: ${transaction._id}`, {
        orderId: order._id,
        amount: totalAmount,
        reference: paymentResult.data.reference,
      });

      return { order, transaction, idempotencyKey: transactionKey };
    });
  }

  /**
   * Complete a transaction after successful payment verification
   * Updates Order, Transaction, Event stats, and creates Tickets atomically
   *
   * @param {string} transactionId - Transaction ID
   * @param {Object} verificationData - Payment verification data from Paystack
   * @param {Function} ticketGenerator - Async function to generate tickets (receives order, event, user, session)
   * @returns {Promise<Object>} { transaction, order, tickets }
   */
  async completeTransaction(transactionId, verificationData, ticketGenerator) {
    return this.withTransaction(async (session) => {
      // Find and lock transaction
      const transaction = await Transaction.findById(transactionId).session(
        session
      );
      if (!transaction) {
        throw new Error("Transaction not found");
      }

      // Validate state transition
      if (!this.validateStateTransition(transaction.status, "completed")) {
        throw new Error(
          `Cannot complete transaction in ${transaction.status} state`
        );
      }

      // Find order
      const order = await Order.findById(transaction.order).session(session);
      if (!order) {
        throw new Error("Order not found");
      }

      // Update order
      order.paymentStatus = "completed";
      order.paystack.transactionId = verificationData.id;
      order.paystack.channel = verificationData.channel;
      order.paystack.paidAt = verificationData.paid_at;

      // Calculate and store splits
      const paidAmountNaira = verificationData.amount / 100;
      const feesNaira = (verificationData.fees || 0) / 100;

      let splits;
      if (verificationData.subaccount) {
        const platformAmountNaira = (verificationData.share?.amount || 0) / 100;
        const organizerAmountNaira =
          paidAmountNaira - platformAmountNaira - feesNaira;

        splits = {
          platformAmount: platformAmountNaira,
          organizerAmount: organizerAmountNaira,
          paystackFees: feesNaira,
          subaccountCode: verificationData.subaccount.subaccount_code,
        };
      } else {
        // No subaccount - calculate locally
        const paystackService = require("./paystackService");
        splits = paystackService.calculateSplit(order.totalAmount);
        splits.paystackFees = feesNaira;
      }

      order.splits = {
        platformAmount: splits.platformAmount,
        organizerAmount: splits.organizerAmount,
      };
      await order.save({ session });

      // Update transaction
      transaction.status = "completed";
      transaction.completedAt = new Date();
      transaction.gateway.transactionId = verificationData.id;
      transaction.gateway.channel = verificationData.channel;
      transaction.gateway.gatewayResponse = verificationData.gateway_response;
      transaction.gateway.fees = feesNaira;

      if (verificationData.authorization) {
        transaction.gateway.cardType = verificationData.authorization.card_type;
        transaction.gateway.last4 = verificationData.authorization.last4;
        transaction.gateway.bank = verificationData.authorization.bank;
      }

      transaction.splits.platformAmount = splits.platformAmount;
      transaction.splits.organizerAmount = splits.organizerAmount;
      transaction.splits.paystackFees = splits.paystackFees;
      if (splits.subaccountCode) {
        transaction.splits.organizerSubaccountCode = splits.subaccountCode;
      }
      await transaction.save({ session });

      // Update event stats
      const event = await Event.findById(order.event).session(session);
      const tier = event.ticketTiers.id(order.tierId);
      tier.soldCount += order.quantity;
      event.totalTicketsSold += order.quantity;
      event.totalRevenue += order.totalAmount;
      await event.save({ session });

      // Generate tickets if generator provided
      let tickets = [];
      if (ticketGenerator) {
        const User = require("../models/User");
        const user = await User.findById(order.user).session(session);
        tickets = await ticketGenerator(order, event, user, session);

        // Update order with ticket references
        order.tickets = tickets.map((t) => t._id);
        await order.save({ session });
      }

      logger.info(`Transaction completed: ${transaction._id}`, {
        orderId: order._id,
        ticketCount: tickets.length,
      });

      return { transaction, order, tickets, splits };
    });
  }

  /**
   * Mark a transaction as failed
   *
   * @param {string} transactionId - Transaction ID
   * @param {Object} failureInfo - Failure details
   * @param {string} failureInfo.reason - Human-readable failure reason
   * @param {string} failureInfo.code - Error code (optional)
   * @param {Object} failureInfo.details - Additional details (optional)
   * @returns {Promise<Object>} Updated transaction
   */
  async failTransaction(transactionId, failureInfo = {}) {
    return this.withTransaction(async (session) => {
      const transaction = await Transaction.findById(transactionId).session(
        session
      );
      if (!transaction) {
        throw new Error("Transaction not found");
      }

      // Validate state transition
      if (!this.validateStateTransition(transaction.status, "failed")) {
        throw new Error(
          `Cannot fail transaction in ${transaction.status} state`
        );
      }

      transaction.status = "failed";
      transaction.failedAt = new Date();
      transaction.failureReason =
        failureInfo.reason || "Payment verification failed";
      transaction.failureCode = failureInfo.code;
      transaction.failureDetails = failureInfo.details;
      await transaction.save({ session });

      // Also update associated order
      const order = await Order.findById(transaction.order).session(session);
      if (order) {
        order.paymentStatus = "failed";
        await order.save({ session });
      }

      logger.warn(`Transaction failed: ${transaction._id}`, {
        reason: transaction.failureReason,
        code: transaction.failureCode,
      });

      return transaction;
    });
  }

  /**
   * Retry a failed transaction
   * Validates retry eligibility, updates state, and re-initializes payment
   *
   * @param {string} transactionId - Transaction ID
   * @param {Object} user - User object for audit
   * @returns {Promise<Object>} { transaction, paymentResult }
   */
  async retryTransaction(transactionId, user) {
    const transaction = await Transaction.findById(transactionId)
      .populate("order")
      .populate("event");

    if (!transaction) {
      throw new Error("Transaction not found");
    }

    // Validate retry eligibility
    const retryCheck = this.canRetry(transaction);
    if (!retryCheck.canRetry) {
      throw new Error(retryCheck.reason);
    }

    // Calculate delay for exponential backoff
    const delay = this.calculateRetryDelay(transaction.retryCount);

    // Wait for backoff delay
    if (delay > 0 && transaction.retryCount > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    // Update transaction state
    transaction.status = "processing";
    transaction.retryCount += 1;
    transaction.lastRetryAt = new Date();
    transaction.processingAt = new Date();
    transaction.nextRetryAt = new Date(
      Date.now() + this.calculateRetryDelay(transaction.retryCount)
    );
    await transaction.save();

    // Get required data for payment
    const event = await Event.findById(transaction.event).populate("organizer");
    const User = require("../models/User");
    const transactionUser = await User.findById(transaction.user);

    if (!transactionUser) {
      throw new Error("User not found");
    }

    // Generate new reference
    const newReference = `retry_${transaction.retryCount}_${Date.now()}_${
      transaction.user
    }`;
    const subaccountCode =
      event?.organizer?.organizerProfile?.paystack?.subaccountCode;

    // Re-initialize payment
    const paystackService = require("./paystackService");
    const paymentResult = await paystackService.initializePayment({
      email: transactionUser.email,
      amount: transaction.amount,
      subaccountCode,
      reference: newReference,
      metadata: {
        originalTransactionId: transaction._id.toString(),
        retryCount: transaction.retryCount,
        orderId: transaction.order._id.toString(),
        eventId: event._id.toString(),
      },
    });

    if (!paymentResult.status) {
      // Revert to failed state
      transaction.status = "failed";
      transaction.failureReason = "Failed to re-initialize payment";
      await transaction.save();
      throw new Error("Failed to re-initialize payment with Paystack");
    }

    // Update reference
    transaction.gateway.reference = paymentResult.data.reference;
    await transaction.save();

    logger.info(`Transaction retry initiated: ${transaction._id}`, {
      retryCount: transaction.retryCount,
      newReference: paymentResult.data.reference,
    });

    return { transaction, paymentResult };
  }

  // ============================================
  // PHASE 3: REFUND & ADVANCED OPERATIONS
  // ============================================

  /**
   * Process a refund for a transaction
   * Supports both full and partial refunds
   *
   * @param {string} transactionId - Transaction ID
   * @param {Object} refundData - Refund details
   * @param {number} refundData.amount - Refund amount (optional, defaults to full refund)
   * @param {string} refundData.reason - Reason for refund
   * @param {string} refundData.processedBy - User ID processing the refund
   * @returns {Promise<Object>} Updated transaction
   */
  async refundTransaction(transactionId, refundData = {}) {
    const { amount, reason, processedBy } = refundData;

    return this.withTransaction(async (session) => {
      const transaction = await Transaction.findById(transactionId).session(
        session
      );

      if (!transaction) {
        throw new Error("Transaction not found");
      }

      // Validate refund eligibility
      const refundCheck = this.canRefund(transaction, amount);
      if (!refundCheck.canRefund) {
        throw new Error(refundCheck.reason);
      }

      // Determine refund amount (full or partial)
      const refundAmount = amount || refundCheck.maxRefundable;

      // Add refund record
      transaction.refunds.push({
        amount: refundAmount,
        reason: reason || "Refund requested",
        processedBy: processedBy,
        processedAt: new Date(),
      });

      // Update totals
      transaction.totalRefunded += refundAmount;

      // Determine new status
      const isFullRefund = transaction.totalRefunded >= transaction.amount;
      const newStatus = isFullRefund ? "refunded" : "partially_refunded";

      // Validate state transition
      if (!this.validateStateTransition(transaction.status, newStatus)) {
        throw new Error(
          `Cannot transition from ${transaction.status} to ${newStatus}`
        );
      }

      transaction.status = newStatus;
      await transaction.save({ session });

      // Update associated order if needed
      if (isFullRefund) {
        const order = await Order.findById(transaction.order).session(session);
        if (order) {
          order.paymentStatus = "refunded";
          await order.save({ session });
        }
      }

      logger.info(`Transaction refunded: ${transaction._id}`, {
        refundAmount,
        totalRefunded: transaction.totalRefunded,
        status: transaction.status,
      });

      return transaction;
    });
  }

  /**
   * Get transaction by ID with full population
   * @param {string} transactionId - Transaction ID
   * @returns {Promise<Object|null>} Transaction with populated relations
   */
  async getTransactionById(transactionId) {
    return Transaction.findById(transactionId)
      .populate("user", "fullName email phone")
      .populate("event", "title eventDate venue")
      .populate("order")
      .populate("refunds.processedBy", "fullName");
  }

  /**
   * Get transactions with filtering and pagination
   * @param {Object} options - Query options
   * @param {Object} options.filter - Filter criteria
   * @param {number} options.page - Page number (1-indexed)
   * @param {number} options.limit - Items per page
   * @param {string} options.sortBy - Field to sort by
   * @param {string} options.sortOrder - 'asc' or 'desc'
   * @returns {Promise<Object>} { transactions, pagination }
   */
  async getTransactions(options = {}) {
    const {
      filter = {},
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = options;

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate("user", "fullName email")
        .populate("event", "title")
        .populate("order"),
      Transaction.countDocuments(filter),
    ]);

    return {
      transactions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Get transactions for a specific user
   * @param {string} userId - User ID
   * @param {Object} options - Pagination options
   * @returns {Promise<Object>} { transactions, pagination }
   */
  async getTransactionsByUser(userId, options = {}) {
    return this.getTransactions({
      ...options,
      filter: { ...options.filter, user: userId },
    });
  }

  /**
   * Get transactions for a specific event
   * @param {string} eventId - Event ID
   * @param {Object} options - Pagination options
   * @returns {Promise<Object>} { transactions, pagination }
   */
  async getTransactionsByEvent(eventId, options = {}) {
    return this.getTransactions({
      ...options,
      filter: { ...options.filter, event: eventId },
    });
  }

  /**
   * Get transaction statistics
   * @param {Object} options - Filter options
   * @param {Date} options.startDate - Start date filter
   * @param {Date} options.endDate - End date filter
   * @param {string} options.eventId - Event ID filter (optional)
   * @returns {Promise<Object>} Statistics object
   */
  async getTransactionStats(options = {}) {
    const { startDate, endDate, eventId } = options;

    const matchStage = {};
    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) matchStage.createdAt.$lte = new Date(endDate);
    }
    if (eventId) {
      matchStage.event = new mongoose.Types.ObjectId(eventId);
    }

    const stats = await Transaction.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
          totalRefunded: { $sum: "$totalRefunded" },
          avgAmount: { $avg: "$amount" },
          completedCount: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
          },
          failedCount: {
            $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
          },
          pendingCount: {
            $sum: {
              $cond: [{ $in: ["$status", ["initiated", "processing"]] }, 1, 0],
            },
          },
          refundedCount: {
            $sum: {
              $cond: [
                { $in: ["$status", ["refunded", "partially_refunded"]] },
                1,
                0,
              ],
            },
          },
          platformRevenue: { $sum: "$splits.platformAmount" },
          organizerRevenue: { $sum: "$splits.organizerAmount" },
          totalFees: { $sum: "$splits.paystackFees" },
        },
      },
    ]);

    // Status distribution
    const statusDistribution = await Transaction.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          amount: { $sum: "$amount" },
        },
      },
    ]);

    return {
      summary: stats[0] || {
        totalTransactions: 0,
        totalAmount: 0,
        totalRefunded: 0,
        avgAmount: 0,
        completedCount: 0,
        failedCount: 0,
        pendingCount: 0,
        refundedCount: 0,
        platformRevenue: 0,
        organizerRevenue: 0,
        totalFees: 0,
      },
      statusDistribution,
    };
  }
}

// Export singleton instance
module.exports = new TransactionService();
