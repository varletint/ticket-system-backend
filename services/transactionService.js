const mongoose = require("mongoose");
const Transaction = require("../models/Transaction");
const Order = require("../models/Order");
const Event = require("../models/Event");
const Ticket = require("../models/Ticket");
const logger = require("../utils/logger");

const STATE_TRANSITIONS = {
  initiated: ["processing", "completed", "failed"],
  processing: ["completed", "failed"],
  completed: ["refunded", "partially_refunded"],
  failed: ["processing"],
  refunded: [],
  partially_refunded: ["refunded"],
};

class TransactionService {
  validateStateTransition(fromState, toState) {
    const allowedTransitions = STATE_TRANSITIONS[fromState];
    if (!allowedTransitions) {
      logger.warn(`Unknown transaction state: ${fromState}`);
      return false;
    }
    return allowedTransitions.includes(toState);
  }

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

  generateIdempotencyKey(userId, eventId, tierId) {
    const timestamp = Date.now();
    return `txn_${userId}_${eventId}_${tierId}_${timestamp}`;
  }

  generateReference(prefix = "order", userId) {
    return `${prefix}_${Date.now()}_${userId}`;
  }

  calculateRetryDelay(retryCount, baseDelay = 1000, maxDelay = 30000) {
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
    const jitter = delay * 0.1 * (Math.random() * 2 - 1);
    return Math.floor(delay + jitter);
  }

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

  async updateState(transaction, newState, session = null) {
    if (!this.validateStateTransition(transaction.status, newState)) {
      throw new Error(
        `Invalid state transition: ${transaction.status} → ${newState}`
      );
    }

    transaction.status = newState;

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

  async findByIdempotencyKey(idempotencyKey) {
    return Transaction.findOne({ idempotencyKey }).populate("order");
  }

  async findByReference(reference) {
    return Transaction.findOne({ "gateway.reference": reference })
      .populate("order")
      .populate("user", "fullName email")
      .populate("event", "title");
  }

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

  async completeTransaction(transactionId, verificationData, ticketGenerator) {
    return this.withTransaction(async (session) => {
      const transaction = await Transaction.findById(transactionId).session(
        session
      );
      if (!transaction) {
        throw new Error("Transaction not found");
      }

      if (!this.validateStateTransition(transaction.status, "completed")) {
        throw new Error(
          `Cannot complete transaction in ${transaction.status} state`
        );
      }

      const order = await Order.findById(transaction.order).session(session);
      if (!order) {
        throw new Error("Order not found");
      }

      order.paymentStatus = "completed";
      order.paystack.transactionId = verificationData.id;
      order.paystack.channel = verificationData.channel;
      order.paystack.paidAt = verificationData.paid_at;

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
        const paystackService = require("./paystackService");
        splits = paystackService.calculateSplit(order.totalAmount);
        splits.paystackFees = feesNaira;
      }

      order.splits = {
        platformAmount: splits.platformAmount,
        organizerAmount: splits.organizerAmount,
      };
      await order.save({ session });

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

      const event = await Event.findById(order.event).session(session);
      const tier = event.ticketTiers.id(order.tierId);
      tier.soldCount += order.quantity;
      event.totalTicketsSold += order.quantity;
      event.totalRevenue += order.totalAmount;
      await event.save({ session });

      let tickets = [];
      if (ticketGenerator) {
        const User = require("../models/User");
        const user = await User.findById(order.user).session(session);
        tickets = await ticketGenerator(order, event, user, session);

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

  async failTransaction(transactionId, failureInfo = {}) {
    return this.withTransaction(async (session) => {
      const transaction = await Transaction.findById(transactionId).session(
        session
      );
      if (!transaction) {
        throw new Error("Transaction not found");
      }

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

  async retryTransaction(transactionId, user) {
    const transaction = await Transaction.findById(transactionId)
      .populate("order")
      .populate("event");

    if (!transaction) {
      throw new Error("Transaction not found");
    }

    const retryCheck = this.canRetry(transaction);
    if (!retryCheck.canRetry) {
      throw new Error(retryCheck.reason);
    }

    const delay = this.calculateRetryDelay(transaction.retryCount);

    if (delay > 0 && transaction.retryCount > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    transaction.status = "processing";
    transaction.retryCount += 1;
    transaction.lastRetryAt = new Date();
    transaction.processingAt = new Date();
    transaction.nextRetryAt = new Date(
      Date.now() + this.calculateRetryDelay(transaction.retryCount)
    );
    await transaction.save();

    const event = await Event.findById(transaction.event).populate("organizer");
    const User = require("../models/User");
    const transactionUser = await User.findById(transaction.user);

    if (!transactionUser) {
      throw new Error("User not found");
    }

    const newReference = `retry_${transaction.retryCount}_${Date.now()}_${
      transaction.user
    }`;
    const subaccountCode =
      event?.organizer?.organizerProfile?.paystack?.subaccountCode;

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
      transaction.status = "failed";
      transaction.failureReason = "Failed to re-initialize payment";
      await transaction.save();
      throw new Error("Failed to re-initialize payment with Paystack");
    }

    transaction.gateway.reference = paymentResult.data.reference;
    await transaction.save();

    logger.info(`Transaction retry initiated: ${transaction._id}`, {
      retryCount: transaction.retryCount,
      newReference: paymentResult.data.reference,
    });

    return { transaction, paymentResult };
  }

  async refundTransaction(transactionId, refundData = {}) {
    const { amount, reason, processedBy } = refundData;

    return this.withTransaction(async (session) => {
      const transaction = await Transaction.findById(transactionId).session(
        session
      );

      if (!transaction) {
        throw new Error("Transaction not found");
      }

      const refundCheck = this.canRefund(transaction, amount);
      if (!refundCheck.canRefund) {
        throw new Error(refundCheck.reason);
      }

      const refundAmount = amount || refundCheck.maxRefundable;

      transaction.refunds.push({
        amount: refundAmount,
        reason: reason || "Refund requested",
        processedBy: processedBy,
        processedAt: new Date(),
      });

      transaction.totalRefunded += refundAmount;

      const isFullRefund = transaction.totalRefunded >= transaction.amount;
      const newStatus = isFullRefund ? "refunded" : "partially_refunded";

      if (!this.validateStateTransition(transaction.status, newStatus)) {
        throw new Error(
          `Cannot transition from ${transaction.status} to ${newStatus}`
        );
      }

      transaction.status = newStatus;
      await transaction.save({ session });

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

  async getTransactionById(transactionId) {
    return Transaction.findById(transactionId)
      .populate("user", "fullName email phone")
      .populate("event", "title eventDate venue")
      .populate("order")
      .populate("refunds.processedBy", "fullName");
  }

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

  async getTransactionsByUser(userId, options = {}) {
    return this.getTransactions({
      ...options,
      filter: { ...options.filter, user: userId },
    });
  }

  async getTransactionsByEvent(eventId, options = {}) {
    return this.getTransactions({
      ...options,
      filter: { ...options.filter, event: eventId },
    });
  }

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

module.exports = new TransactionService();
