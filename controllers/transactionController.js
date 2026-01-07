const Transaction = require("../models/Transaction");
const Order = require("../models/Order");
const Event = require("../models/Event");
const Ticket = require("../models/Ticket");
const auditService = require("../services/auditService");

/**
 * Transaction Controller
 * Handles transaction monitoring, retries, and administration.
 */

// Get all transactions with filters
// GET /api/transactions
const getTransactions = async (req, res) => {
  try {
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
  } catch (error) {
    console.error("Get transactions error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch transactions" });
  }
};

// Get transaction by ID
// GET /api/transactions/:id
const getTransaction = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id)
      .populate("user", "fullName email phone")
      .populate("event", "title eventDate venue")
      .populate("order")
      .populate("refunds.processedBy", "fullName");

    if (!transaction) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }

    res.json({ success: true, data: transaction });
  } catch (error) {
    console.error("Get transaction error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch transaction" });
  }
};

// Get transaction statistics
// GET /api/transactions/stats
const getTransactionStats = async (req, res) => {
  try {
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
  } catch (error) {
    console.error("Get transaction stats error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch transaction stats" });
  }
};

// Retry failed transaction
// POST /api/transactions/:id/retry
const retryTransaction = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }

    if (!transaction.canRetry()) {
      return res.status(400).json({
        success: false,
        message:
          transaction.status !== "failed"
            ? "Only failed transactions can be retried"
            : "Maximum retry attempts reached",
      });
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

    // Here you would typically re-initiate the payment with Paystack
    // For mock, we simulate success after a delay
    setTimeout(async () => {
      try {
        transaction.status = "completed";
        transaction.completedAt = new Date();
        await transaction.save();
        await auditService.logTransaction(
          "transaction.complete",
          transaction,
          req.user
        );
      } catch (err) {
        console.error("Retry completion error:", err);
      }
    }, 2000);

    res.json({
      success: true,
      message: "Transaction retry initiated",
      data: transaction,
    });
  } catch (error) {
    console.error("Retry transaction error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to retry transaction" });
  }
};

// Process refund
// POST /api/transactions/:id/refund
const refundTransaction = async (req, res) => {
  try {
    const { amount, reason } = req.body;
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }

    if (!transaction.isRefundable()) {
      return res.status(400).json({
        success: false,
        message: "Transaction is not refundable",
      });
    }

    const refundAmount = amount || transaction.netAmount;
    if (refundAmount > transaction.netAmount) {
      return res.status(400).json({
        success: false,
        message: `Refund amount cannot exceed ₦${transaction.netAmount.toLocaleString()}`,
      });
    }

    // Add refund record
    transaction.refunds.push({
      amount: refundAmount,
      reason: reason || "Admin refund",
      processedBy: req.user.userId,
    });
    transaction.totalRefunded += refundAmount;
    transaction.status =
      refundAmount >= transaction.amount ? "refunded" : "partially_refunded";
    await transaction.save();

    // Log the refund
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
  } catch (error) {
    console.error("Refund transaction error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to process refund" });
  }
};

module.exports = {
  getTransactions,
  getTransaction,
  getTransactionStats,
  retryTransaction,
  refundTransaction,
};
