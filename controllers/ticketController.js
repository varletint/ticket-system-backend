const Event = require("../models/Event");
const Order = require("../models/Order");
const Ticket = require("../models/Ticket");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const qrService = require("../services/qrService");
const pdfService = require("../services/pdfService");
const paystackService = require("../services/paystackService");
const auditService = require("../services/auditService");

/**
 * Initialize ticket purchase with idempotency support
 * POST /api/tickets/purchase
 *
 * Accepts an Idempotency-Key header to prevent duplicate charges during retries.
 * If the same idempotency key is used, returns the existing transaction/order.
 */
const initializePurchase = async (req, res) => {
  try {
    const { eventId, tierId, quantity } = req.body;
    const idempotencyKey =
      req.headers["idempotency-key"] || req.headers["x-idempotency-key"];

    if (idempotencyKey) {
      const existingTransaction = await Transaction.findOne({
        idempotencyKey,
      }).populate("order");

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
    if (!quantity || quantity < 1 || quantity > 10) {
      return res
        .status(400)
        .json({ message: "Quantity must be between 1 and 10" });
    }

    const event = await Event.findById(eventId).populate("organizer");
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (event.status !== "published") {
      return res
        .status(400)
        .json({ message: "Event is not available for purchase" });
    }

    const tier = event.ticketTiers.id(tierId);
    if (!tier) {
      return res.status(404).json({ message: "Ticket tier not found" });
    }

    const available = tier.quantity - tier.soldCount;
    if (quantity > available) {
      return res.status(400).json({
        message: `Only ${available} tickets available`,
        available,
      });
    }

    // Check per-user limit
    const existingTickets = await Ticket.countDocuments({
      user: req.user._id,
      event: eventId,
      tierId: tierId,
      status: { $ne: "cancelled" },
    });

    if (existingTickets + quantity > tier.maxPerUser) {
      return res.status(400).json({
        message: `Maximum ${tier.maxPerUser} tickets per user (you have ${existingTickets})`,
      });
    }

    const totalAmount = tier.price * quantity;
    const reference = `order_${Date.now()}_${req.user._id}`;

    const subaccountCode =
      event.organizer.organizerProfile?.paystack?.subaccountCode;

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

    if (!paymentResult.success) {
      return res.status(500).json({ message: "Failed to initialize payment" });
    }

    const order = await Order.create({
      user: req.user._id,
      event: eventId,
      tierName: tier.name,
      tierId: tierId,
      quantity,
      unitPrice: tier.price,
      totalAmount,
      paymentStatus: "pending",
      paystack: {
        reference: paymentResult.data.reference,
      },
    });

    // Create transaction record with idempotency key
    const transactionKey = idempotencyKey || `auto_${order._id}_${Date.now()}`;
    const transaction = await Transaction.create({
      idempotencyKey: transactionKey,
      status: "initiated",
      user: req.user._id,
      order: order._id,
      event: eventId,
      amount: totalAmount,
      gateway: {
        provider: process.env.PAYSTACK_SECRET_KEY ? "paystack" : "mock",
        reference: paymentResult.data.reference,
      },
      splits: {
        organizerSubaccountCode: subaccountCode,
      },
      metadata: {
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        tierName: tier.name,
        quantity,
      },
    });

    await auditService.logTransaction(
      "transaction.initiate",
      transaction,
      req.user
    );

    res.json({
      message: "Payment initialized",
      order: {
        id: order._id,
        reference: paymentResult.data.reference,
        amount: totalAmount,
      },
      transaction: {
        id: transaction._id,
        idempotencyKey: transactionKey,
      },
      paymentUrl: paymentResult.data.authorization_url,
    });
  } catch (error) {
    console.error("Initialize purchase error:", error);
    await auditService.logError(
      error,
      {
        endpoint: "/api/tickets/purchase",
        method: "POST",
      },
      req.user
    );
    res.status(500).json({ message: "Error initializing purchase" });
  }
};

/**
 * Verify payment and create tickets
 * POST /api/tickets/verify
 */
const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.body;

    const order = await Order.findOne({
      "paystack.reference": reference,
    }).populate("event");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (order.paymentStatus === "completed") {
      return res.json({ message: "Payment already verified", order });
    }

    const verification = await paystackService.verifyPayment(reference);

    if (!verification.success || verification.data.status !== "success") {
      order.paymentStatus = "failed";
      await order.save();

      const transaction = await Transaction.findOne({ order: order._id });
      if (transaction) {
        transaction.status = "failed";
        transaction.failedAt = new Date();
        transaction.failureReason =
          verification.data?.gateway_response || "Payment verification failed";
        await transaction.save();

        await auditService.logTransaction(
          "transaction.fail",
          transaction,
          req.user
        );
      }

      return res.status(400).json({ message: "Payment verification failed" });
    }

    order.paymentStatus = "completed";
    order.paystack.transactionId = verification.data.id;
    order.paystack.channel = verification.data.channel;
    order.paystack.paidAt = verification.data.paid_at;

    // Calculate splits
    const splits = paystackService.calculateSplit(order.totalAmount);
    order.splits = splits;

    const transaction = await Transaction.findOne({ order: order._id });
    if (transaction) {
      transaction.status = "completed";
      transaction.completedAt = new Date();
      transaction.gateway.transactionId = verification.data.id;
      transaction.gateway.channel = verification.data.channel;
      transaction.gateway.gatewayResponse = verification.data.gateway_response;
      if (verification.data.authorization) {
        transaction.gateway.cardType =
          verification.data.authorization.card_type;
        transaction.gateway.last4 = verification.data.authorization.last4;
        transaction.gateway.bank = verification.data.authorization.bank;
      }
      transaction.splits.platformAmount = splits.platformAmount;
      transaction.splits.organizerAmount = splits.organizerAmount;
      await transaction.save();

      await auditService.logTransaction(
        "transaction.complete",
        transaction,
        req.user
      );
    }

    const event = await Event.findById(order.event._id);
    const tier = event.ticketTiers.id(order.tierId);
    tier.soldCount += order.quantity;
    event.totalTicketsSold += order.quantity;
    event.totalRevenue += order.totalAmount;
    await event.save();

    // Generate tickets
    const user = await User.findById(order.user);
    const tickets = [];

    for (let i = 0; i < order.quantity; i++) {
      // Generate QR token
      const tempId = `${order._id}_${i}_${Date.now()}`;
      const qrToken = qrService.generateTicketToken(tempId, event._id);

      // Create ticket
      const ticket = await Ticket.create({
        order: order._id,
        event: event._id,
        user: order.user,
        tierName: order.tierName,
        tierId: order.tierId,
        price: order.unitPrice,
        qrCode: qrToken,
      });

      // Generate QR image
      const qrImage = await qrService.generateQRImage(qrToken);

      // Generate PDF
      const pdfResult = await pdfService.generateTicketPDF({
        ticket,
        event,
        user,
        qrImageDataUrl: qrImage,
      });

      // Update ticket with PDF URL
      ticket.pdfUrl = pdfResult.url;
      ticket.qrCode = qrToken; // Update with final token
      await ticket.save();

      tickets.push(ticket);
    }

    order.tickets = tickets.map((t) => t._id);
    await order.save();

    res.json({
      message: "Payment verified and tickets generated",
      order: {
        id: order._id,
        status: order.paymentStatus,
        tickets: tickets.map((t) => ({
          id: t._id,
          tierName: t.tierName,
          pdfUrl: t.pdfUrl,
        })),
      },
    });
  } catch (error) {
    console.error("Verify payment error:", error);
    res.status(500).json({ message: "Error verifying payment" });
  }
};

/**
 * Get user's tickets
 * GET /api/tickets/my-tickets
 */
const getMyTickets = async (req, res) => {
  try {
    const tickets = await Ticket.find({ user: req.user._id })
      .populate("event", "title artist eventDate venue bannerImage status")
      .sort({ createdAt: -1 });

    res.json({ tickets });
  } catch (error) {
    console.error("Get my tickets error:", error);
    res.status(500).json({ message: "Error fetching tickets" });
  }
};

/**
 * Get single ticket details
 * GET /api/tickets/:id
 */
const getTicket = async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id)
      .populate("event", "title artist eventDate venue bannerImage organizer")
      .populate("order");

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    // Only ticket owner or admin can view
    if (
      ticket.user.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({ message: "Not authorized" });
    }

    res.json({ ticket });
  } catch (error) {
    console.error("Get ticket error:", error);
    res.status(500).json({ message: "Error fetching ticket" });
  }
};

/**
 * Download ticket PDF
 * GET /api/tickets/:id/download
 */
const downloadTicket = async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id)
      .populate("event")
      .populate("user");

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    if (
      ticket.user._id.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({ message: "Not authorized" });
    }

    // Regenerate PDF if needed
    if (!ticket.pdfUrl) {
      const qrImage = await qrService.generateQRImage(ticket.qrCode);
      const pdfResult = await pdfService.generateTicketPDF({
        ticket,
        event: ticket.event,
        user: ticket.user,
        qrImageDataUrl: qrImage,
      });
      ticket.pdfUrl = pdfResult.url;
      await ticket.save();
    }

    res.json({
      pdfUrl: ticket.pdfUrl,
      fileName: `ticket_${ticket._id}.pdf`,
    });
  } catch (error) {
    console.error("Download ticket error:", error);
    res.status(500).json({ message: "Error downloading ticket" });
  }
};

module.exports = {
  initializePurchase,
  verifyPayment,
  getMyTickets,
  getTicket,
  downloadTicket,
};
