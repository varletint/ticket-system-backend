const Event = require("../models/Event");
const Order = require("../models/Order");
const Ticket = require("../models/Ticket");
const Transaction = require("../models/Transaction");
const qrService = require("../services/qrService");
const pdfService = require("../services/pdfService");
const paystackService = require("../services/paystackService");
const transactionService = require("../services/transactionService");
const auditService = require("../services/auditService");
const logger = require("../utils/logger");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");

/**
 * Initialize ticket purchase with idempotency support
 * Uses TransactionService for atomic Order + Transaction creation
 * POST /api/tickets/purchase
 */
const initializePurchase = asyncHandler(async (req, res) => {
  const { eventId, tierId, quantity } = req.body;
  const idempotencyKey =
    req.headers["idempotency-key"] || req.headers["x-idempotency-key"];

  // Check for existing transaction with idempotency key
  if (idempotencyKey) {
    const existingTransaction = await transactionService.findByIdempotencyKey(
      idempotencyKey
    );

    if (existingTransaction) {
      return res.json({
        message: "Payment already initialized (idempotent)",
        isIdempotent: true,
        order: existingTransaction.order
          ? {
              id: existingTransaction.order._id,
              reference: existingTransaction.gateway.reference,
              amount: existingTransaction.amount,
            }
          : null,
        transaction: {
          id: existingTransaction._id,
          status: existingTransaction.status,
        },
      });
    }
  }

  // Validate quantity
  if (!quantity || quantity < 1 || quantity > 10) {
    throw ApiError.badRequest("Quantity must be between 1 and 10");
  }

  // Find and validate event
  const event = await Event.findById(eventId).populate("organizer");
  if (!event) {
    throw ApiError.notFound("Event not found");
  }

  if (event.status !== "published") {
    throw ApiError.badRequest("Event is not available for purchase");
  }

  // Find and validate tier
  const tier = event.ticketTiers.id(tierId);
  if (!tier) {
    throw ApiError.notFound("Ticket tier not found");
  }

  const available = tier.quantity - tier.soldCount;
  if (quantity > available) {
    throw ApiError.badRequest(`Only ${available} tickets available`);
  }

  // Check per-user limit
  const existingTickets = await Ticket.countDocuments({
    user: req.user._id,
    event: eventId,
    tierId: tierId,
    status: { $ne: "cancelled" },
  });

  if (existingTickets + quantity > tier.maxPerUser) {
    throw ApiError.badRequest(
      `Maximum ${tier.maxPerUser} tickets per user (you have ${existingTickets})`
    );
  }

  // Initialize payment with Paystack
  const totalAmount = tier.price * quantity;
  const reference = transactionService.generateReference("order", req.user._id);
  const subaccountCode =
    event.organizer?.organizerProfile?.paystack?.subaccountCode;

  const paymentResult = await paystackService.initializePayment({
    email: req.user.email,
    amount: totalAmount,
    subaccountCode,
    reference,
    metadata: {
      eventId,
      tierId,
      quantity,
      userId: req.user._id.toString(),
    },
  });

  if (!paymentResult.status) {
    throw ApiError.internal("Failed to initialize payment");
  }

  // Use TransactionService for atomic Order + Transaction creation
  const result = await transactionService.initiateTransaction({
    user: req.user,
    event,
    tier,
    quantity,
    idempotencyKey,
    paymentResult,
    metadata: {
      ipAddress: req.clientIp,
      userAgent: req.get("user-agent"),
    },
  });

  // Log audit event
  await auditService.logTransaction(
    "transaction.initiate",
    result.transaction,
    req.user
  );

  res.json({
    message: "Payment initialized",
    order: {
      id: result.order._id,
      reference: paymentResult.data.reference,
      amount: totalAmount,
    },
    transaction: {
      id: result.transaction._id,
      idempotencyKey: result.idempotencyKey,
    },
    paymentUrl: paymentResult.data.authorization_url,
  });
});

/**
 * Verify payment and create tickets
 * Uses TransactionService for atomic completion
 * POST /api/tickets/verify
 */
const verifyPayment = asyncHandler(async (req, res) => {
  const { reference } = req.body;

  // Find transaction by reference
  const transaction = await transactionService.findByReference(reference);

  if (!transaction) {
    throw ApiError.notFound("Transaction not found");
  }

  // Check if already completed
  if (transaction.status === "completed") {
    const order = await Order.findById(transaction.order).populate("tickets");
    return res.json({
      message: "Payment already verified",
      order: {
        id: order._id,
        status: order.paymentStatus,
        tickets: order.tickets.map((t) => ({
          id: t._id,
          tierName: t.tierName,
        })),
      },
    });
  }

  // Verify with Paystack
  const verification = await paystackService.verifyPayment(reference);

  if (!verification.success || verification.data.status !== "success") {
    // Use TransactionService to fail the transaction atomically
    await transactionService.failTransaction(transaction._id, {
      reason:
        verification.data?.gateway_response || "Payment verification failed",
      code: verification.data?.status,
      details: verification.data,
    });

    await auditService.logTransaction(
      "transaction.fail",
      transaction,
      req.user
    );

    throw ApiError.badRequest("Payment verification failed");
  }

  // Define ticket generator for atomic completion
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

  // Use TransactionService for atomic completion
  const result = await transactionService.completeTransaction(
    transaction._id,
    verification.data,
    ticketGenerator
  );

  // Log audit event
  await auditService.logTransaction(
    "transaction.complete",
    result.transaction,
    req.user
  );

  logger.info(`Payment verified: ${transaction._id}`, {
    ticketCount: result.tickets.length,
  });

  res.json({
    message: "Payment verified and tickets generated",
    order: {
      id: result.order._id,
      status: result.order.paymentStatus,
      tickets: result.tickets.map((t) => ({
        id: t._id,
        tierName: t.tierName,
      })),
    },
  });
});

/**
 * Get user's tickets
 * GET /api/tickets/my-tickets
 */
const getMyTickets = asyncHandler(async (req, res) => {
  const tickets = await Ticket.find({ user: req.user._id })
    .populate("event", "title artist eventDate venue bannerImage status")
    .sort({ createdAt: -1 });

  res.json({ tickets });
});

/**
 * Get single ticket details
 * GET /api/tickets/:id
 */
const getTicket = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findById(req.params.id)
    .populate("event", "title artist eventDate venue bannerImage organizer")
    .populate("order");

  if (!ticket) {
    throw ApiError.notFound("Ticket not found");
  }

  // Only ticket owner or admin can view
  if (
    ticket.user.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    throw ApiError.forbidden("Not authorized");
  }

  res.json({ ticket });
});

/**
 * Download ticket PDF
 * GET /api/tickets/:id/download
 */
const downloadTicket = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findById(req.params.id)
    .populate("event")
    .populate("user");

  if (!ticket) {
    throw ApiError.notFound("Ticket not found");
  }

  if (
    ticket.user._id.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    throw ApiError.forbidden("Not authorized");
  }

  // Generate PDF in-memory and stream directly
  const qrImage = await qrService.generateQRImage(ticket.qrCode);
  const pdfBuffer = await pdfService.generateTicketPDF({
    ticket,
    event: ticket.event,
    user: ticket.user,
    qrImageDataUrl: qrImage,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=ticket_${ticket._id}.pdf`
  );
  res.send(pdfBuffer);
});

module.exports = {
  initializePurchase,
  verifyPayment,
  getMyTickets,
  getTicket,
  downloadTicket,
};
