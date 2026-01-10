const transactionService = require("../services/transactionService");
const auditService = require("../services/auditService");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");

/**
 * Transaction Controller
 * Handles transaction monitoring, retries, and administration.
 * Uses TransactionService for all business logic.
 */

/**
 * Get all transactions with filtering and pagination
 * GET /api/transactions
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

  const result = await transactionService.getTransactions({
    filter,
    page: Number(page),
    limit: Number(limit),
    sortBy,
    sortOrder,
  });

  res.json({
    success: true,
    data: result.transactions,
    pagination: result.pagination,
  });
});

/**
 * Get single transaction by ID
 * GET /api/transactions/:id
 */
const getTransaction = asyncHandler(async (req, res) => {
  const transaction = await transactionService.getTransactionById(
    req.params.id
  );

  if (!transaction) {
    throw ApiError.notFound("Transaction not found");
  }

  res.json({ success: true, data: transaction });
});

/**
 * Get transaction statistics
 * GET /api/transactions/stats
 */
const getTransactionStats = asyncHandler(async (req, res) => {
  const { startDate, endDate, eventId } = req.query;

  const result = await transactionService.getTransactionStats({
    startDate,
    endDate,
    eventId,
  });

  res.json({
    success: true,
    data: result,
  });
});

/**
 * Retry failed transaction
 * POST /api/transactions/:id/retry
 */
const retryTransaction = asyncHandler(async (req, res) => {
  const result = await transactionService.retryTransaction(
    req.params.id,
    req.user
  );

  await auditService.logTransaction(
    "transaction.retry",
    result.transaction,
    req.user,
    { retryCount: result.transaction.retryCount }
  );

  res.json({
    success: true,
    message: "Transaction retry initiated",
    data: result.transaction,
    paymentUrl: result.paymentResult.data.authorization_url,
  });
});

/**
 * Process refund
 * POST /api/transactions/:id/refund
 */
const refundTransaction = asyncHandler(async (req, res) => {
  const { amount, reason } = req.body;

  const transaction = await transactionService.refundTransaction(
    req.params.id,
    {
      amount,
      reason,
      processedBy: req.user.userId || req.user._id,
    }
  );

  await auditService.logTransaction(
    "transaction.refund",
    transaction,
    req.user,
    { refundAmount: amount || transaction.amount, reason }
  );

  const refundAmount = amount || transaction.amount - transaction.totalRefunded;

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
