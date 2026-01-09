const Transaction = require("../models/Transaction");
const Order = require("../models/Order");
const Event = require("../models/Event");
const Ticket = require("../models/Ticket");
const User = require("../models/User");
const auditService = require("../services/auditService");
const paystackService = require("../services/paystackService");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");

/**
 * Transaction Controller
 * Handles transaction monitoring, retries, and administration.
 */

const getTransactions = asyncHandler(async (req, res) => {
  const {
    status,
    startDate,
    endDate,
    minAmount,
    maxAmount,
    userId,
    eventId,
    page = 1,
    limit = 20,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = req.query;

  const filter = {};

  // Apply filters
  if (status) filter.status = status;
  if (userId) filter.user = userId;
  if (eventId) filter.event = eventId;

  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }

  if (minAmount || maxAmount) {
    filter.amount = {};
    if (minAmount) filter.amount.$gte = Number(minAmount);
    if (maxAmount) filter.amount.$lte = Number(maxAmount);
  }

  const skip = (page - 1) * limit;
  const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

  const [transactions, total] = await Promise.all([
    Transaction.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(Number(limit))
      .populate("user", "fullName email")
      .populate("event", "title")
      .populate("order"),
    Transaction.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: transactions,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

const getTransaction = asyncHandler(async (req, res) => {
  const transaction = await Transaction.findById(req.params.id)
    .populate("user", "fullName email phone")
    .populate("event", "title eventDate venue")
    .populate("order")
    .populate("refunds.processedBy", "fullName");

  if (!transaction) {
    throw new ApiError("Transaction not found", 404);
  }

  res.json({ success: true, data: transaction });
});

// Get transaction statistics
const getTransactionStats = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const dateFilter = {};
  if (startDate) dateFilter.$gte = new Date(startDate);
  if (endDate) dateFilter.$lte = new Date(endDate);

  const matchStage = {};
  if (startDate || endDate) matchStage.createdAt = dateFilter;

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
      },
    },
  ]);

  // Get status distribution
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

  // Get daily transactions for chart
  const dailyStats = await Transaction.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        count: { $sum: 1 },
        amount: { $sum: "$amount" },
        completed: {
          $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
        },
        failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
    { $limit: 30 },
  ]);

  res.json({
    success: true,
    data: {
      summary: stats[0] || {
        totalTransactions: 0,
        totalAmount: 0,
        totalRefunded: 0,
        avgAmount: 0,
        completedCount: 0,
        failedCount: 0,
        pendingCount: 0,
        refundedCount: 0,
      },
      statusDistribution,
      dailyStats,
    },
  });
});

// Retry failed transaction
// POST /api/transactions/:id/retry
const retryTransaction = asyncHandler(async (req, res) => {
  const transaction = await Transaction.findById(req.params.id);

  if (!transaction) {
    throw new ApiError("Transaction not found", 404);
  }

  if (!transaction.canRetry()) {
    throw ApiError.badRequest(
      transaction.status !== "failed"
        ? "Only failed transactions can be retried"
        : "Maximum retry attempts reached"
    );
  }

  // Update transaction for retry
  transaction.status = "processing";
  transaction.retryCount += 1;
  transaction.lastRetryAt = new Date();
  transaction.processingAt = new Date();
  await transaction.save();

  // Log the retry
  await auditService.logTransaction(
    "transaction.retry",
    transaction,
    req.user,
    {
      retryCount: transaction.retryCount,
    }
  );

  const order = await Order.findById(transaction.order);
  if (!order) {
    throw new ApiError("Associated order not found", 404);
  }

  const event = await Event.findById(transaction.event).populate("organizer");
  const user = await User.findById(transaction.user);

  if (!user) {
    throw new ApiError("Associated user not found", 404);
  }

  const newReference = `retry_${transaction.retryCount}_${Date.now()}_${
    transaction.user
  }`;

  const subaccountCode =
    event?.organizer?.organizerProfile?.paystack?.subaccountCode;

  const paymentResult = await paystackService.initializePayment({
    email: user.email,
    amount: transaction.amount,
    subaccountCode,
    reference: newReference,
    metadata: {
      originalTransactionId: transaction._id.toString(),
      retryCount: transaction.retryCount,
      orderId: order._id.toString(),
      eventId: event._id.toString(),
    },
  });

  if (!paymentResult.status) {
    transaction.status = "failed";
    transaction.failureReason = "Failed to re-initialize payment";
    await transaction.save();
    throw new ApiError("Failed to re-initialize payment with Paystack", 500);
  }

  transaction.gateway.reference = paymentResult.data.reference;
  await transaction.save();

  res.json({
    success: true,
    message: "Transaction retry initiated",
    data: transaction,
    paymentUrl: paymentResult.data.authorization_url,
  });
});

// Process refund
// POST /api/transactions/:id/refund
const refundTransaction = asyncHandler(async (req, res) => {
  const { amount, reason } = req.body;
  const transaction = await Transaction.findById(req.params.id);

  if (!transaction) {
    throw ApiError.notFound("Transaction not found");
  }

  if (!transaction.isRefundable()) {
    throw ApiError.badRequest("Transaction is not refundable");
  }

  const refundAmount = amount || transaction.netAmount;
  if (refundAmount > transaction.netAmount) {
    throw ApiError.badRequest(
      `Refund amount cannot exceed ₦${transaction.netAmount.toLocaleString()}`
    );
  }

  transaction.refunds.push({
    amount: refundAmount,
    reason: reason || "Admin refund",
    processedBy: req.user.userId,
  });
  transaction.totalRefunded += refundAmount;
  transaction.status =
    refundAmount >= transaction.amount ? "refunded" : "partially_refunded";
  await transaction.save();

  await auditService.logTransaction(
    "transaction.refund",
    transaction,
    req.user,
    {
      refundAmount,
      reason,
    }
  );

  res.json({
    success: true,
    message: `Refund of ₦${refundAmount.toLocaleString()} processed successfully`,
    data: transaction,
  });
});

module.exports = {
  getTransactions,
  getTransaction,
  getTransactionStats,
  retryTransaction,
  refundTransaction,
};
