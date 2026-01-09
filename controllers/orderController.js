const Order = require("../models/Order");
const Event = require("../models/Event");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const paystackService = require("../services/paystackService");
const auditService = require("../services/auditService");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");

/**
 * Order Controller
 * Handles user-facing order management
 */

const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id })
    .populate("event", "title eventDate venue bannerImage")
    .sort({ createdAt: -1 });

  const orderIds = orders.map((o) => o._id);
  const transactions = await Transaction.find({ order: { $in: orderIds } });
  const txMap = transactions.reduce((acc, tx) => {
    acc[tx.order.toString()] = tx;
    return acc;
  }, {});

  const ordersWithTx = orders.map((order) => ({
    ...order.toObject(),
    transaction: txMap[order._id.toString()] || null,
  }));

  res.json({ success: true, data: ordersWithTx });
});

const retryPayment = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate("event");

  if (!order) {
    throw ApiError.notFound("Order not found");
  }

  if (order.user.toString() !== req.user._id.toString()) {
    throw ApiError.forbidden("Not authorized to retry this order");
  }
  if (order.paymentStatus === "completed") {
    throw ApiError.badRequest("This order is already completed");
  }

  const transaction = await Transaction.findOne({ order: order._id });

  if (transaction && !transaction.canRetry()) {
    throw ApiError.badRequest(
      transaction.status !== "failed"
        ? "Only failed transactions can be retried"
        : "Maximum retry attempts reached"
    );
  }

  const event = await Event.findById(order.event._id).populate("organizer");
  const user = await User.findById(req.user._id);

  const newReference = `retry_${Date.now()}_${req.user._id}`;

  const subaccountCode =
    event?.organizer?.organizerProfile?.paystack?.subaccountCode;
  const paymentResult = await paystackService.initializePayment({
    email: user.email,
    amount: order.totalAmount,
    subaccountCode,
    reference: newReference,
    metadata: {
      orderId: order._id.toString(),
      eventId: event._id.toString(),
      isRetry: true,
      originalReference: order.paystack?.reference,
    },
  });

  if (!paymentResult.status) {
    throw ApiError.internal("Failed to initialize payment");
  }

  order.paystack.reference = paymentResult.data.reference;
  order.paymentStatus = "pending";
  await order.save();
  if (transaction) {
    transaction.status = "processing";
    transaction.retryCount += 1;
    transaction.lastRetryAt = new Date();
    transaction.gateway.reference = paymentResult.data.reference;
    await transaction.save();

    await auditService.logTransaction("transaction.retry", transaction, user, {
      retryCount: transaction.retryCount,
      initiatedBy: "user",
    });
  }

  res.json({
    success: true,
    message: "Payment retry initiated",
    paymentUrl: paymentResult.data.authorization_url,
  });
});

module.exports = {
  getMyOrders,
  retryPayment,
};
