const Dispute = require("../models/Dispute");
const Order = require("../models/Order");
const Transaction = require("../models/Transaction");
const auditService = require("../services/auditService");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");

/**
 * Dispute Controller
 * Handles dispute creation, management, and resolution.
 */

// Create a new dispute (user)
// POST /api/disputes
const createDispute = asyncHandler(async (req, res) => {
  const { orderId, type, subject, description } = req.body;

  const order = await Order.findById(orderId).populate("event");

  if (!order) throw ApiError.notFound("Order not found");
  if (order.user.toString() !== req.user.userId) {
    throw ApiError.forbidden("Not authorized to dispute this order");
  }

  const existingDispute = await Dispute.findOne({
    order: orderId,
    status: { $in: ["open", "investigating", "pending_user"] },
  });
  if (existingDispute) {
    throw ApiError.badRequest("An open dispute already exists for this order");
  }

  // Priority check to determine priority based on type
  let priority = "medium";
  if (type === "double_charge" || type === "unauthorized") priority = "high";
  if (order.totalAmount > 50000) priority = "high";

  // Calculate SLA deadlines
  const now = new Date();
  const responseDeadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const resolutionDeadline = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const dispute = new Dispute({
    user: req.user.userId,
    order: orderId,
    event: order.event._id,
    type,
    priority,
    subject,
    description,
    amount: order.totalAmount,
    sla: { responseDeadline, resolutionDeadline },
    timeline: [
      {
        action: "Dispute created",
        actor: req.user.userId,
        details: `Type: ${type}`,
      },
    ],
    metadata: {
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  await dispute.save();
  await auditService.logDispute("dispute.create", dispute, req.user);

  res.status(201).json({
    success: true,
    message: "Dispute submitted successfully",
    data: {
      disputeNumber: dispute.disputeNumber,
      status: dispute.status,
      responseDeadline: dispute.sla.responseDeadline,
    },
  });
});

// Get disputes (admin gets all, users get their own)
const getDisputes = asyncHandler(async (req, res) => {
  const {
    status,
    type,
    priority,
    assignedTo,
    page = 1,
    limit = 20,
  } = req.query;

  const filter = {};

  if (req.user.role !== "admin") {
    filter.user = req.user.userId;
  }

  if (status) filter.status = status;
  if (type) filter.type = type;
  if (priority) filter.priority = priority;
  if (assignedTo) filter.assignedTo = assignedTo;

  const skip = (page - 1) * limit;

  const [disputes, total] = await Promise.all([
    Dispute.find(filter)
      .sort({ priority: -1, createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate("user", "fullName email")
      .populate("order", "totalAmount tierName")
      .populate("event", "title")
      .populate("assignedTo", "fullName"),
    Dispute.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: disputes,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

// Get single dispute
// GET /api/disputes/:id
const getDispute = asyncHandler(async (req, res) => {
  const dispute = await Dispute.findById(req.params.id)
    .populate("user", "fullName email phone")
    .populate("order")
    .populate("event", "title eventDate venue")
    .populate("transaction")
    .populate("assignedTo", "fullName email")
    .populate("messages.sender", "fullName")
    .populate("timeline.actor", "fullName")
    .populate("resolution.resolvedBy", "fullName");

  if (!dispute) throw ApiError.notFound("Dispute not found");

  if (
    req.user.role !== "admin" &&
    dispute.user._id.toString() !== req.user.userId
  ) {
    throw ApiError.forbidden("Not authorized");
  }

  res.json({ success: true, data: dispute });
});

// Update dispute (admin)
// PUT /api/disputes/:id
const updateDispute = asyncHandler(async (req, res) => {
  const { status, priority, assignedTo, notes } = req.body;
  const dispute = await Dispute.findById(req.params.id);

  if (!dispute) throw ApiError.notFound("Dispute not found");

  const updates = [];

  if (status && status !== dispute.status) {
    dispute.status = status;
    updates.push(`Status changed to ${status}`);
  }

  if (priority && priority !== dispute.priority) {
    dispute.priority = priority;
    updates.push(`Priority changed to ${priority}`);
  }

  if (assignedTo && assignedTo !== dispute.assignedTo?.toString()) {
    dispute.assignedTo = assignedTo;
    updates.push("Dispute assigned");
  }

  if (notes) {
    await dispute.addMessage(req.user.userId, "admin", notes);
  }

  if (updates.length > 0) {
    dispute.timeline.push({
      action: updates.join("; "),
      actor: req.user.userId,
    });
  }

  await dispute.save();

  await auditService.logDispute("dispute.update", dispute, req.user, {
    updates,
  });

  res.json({
    success: true,
    message: "Dispute updated successfully",
    data: dispute,
  });
});

// Resolve dispute (admin)
// POST /api/disputes/:id/resolve
const resolveDispute = asyncHandler(async (req, res) => {
  const { resolutionType, refundAmount, notes } = req.body;
  const dispute = await Dispute.findById(req.params.id);

  if (!dispute) throw ApiError.notFound("Dispute not found");

  if (["resolved", "rejected"].includes(dispute.status)) {
    throw ApiError.badRequest("Dispute already closed");
  }

  dispute.status = "resolved";
  dispute.resolution = {
    type: resolutionType,
    refundAmount: refundAmount || 0,
    notes,
    resolvedBy: req.user.userId,
    resolvedAt: new Date(),
  };

  dispute.timeline.push({
    action: `Resolved with ${resolutionType}`,
    actor: req.user.userId,
    details: notes,
  });

  await dispute.save();

  // If refund, process it
  if (refundAmount > 0) {
    const transaction = await Transaction.findOne({ order: dispute.order });
    if (transaction) {
      transaction.refunds.push({
        amount: refundAmount,
        reason: `Dispute resolution: ${dispute.disputeNumber}`,
        processedBy: req.user.userId,
      });
      transaction.totalRefunded += refundAmount;
      if (transaction.totalRefunded >= transaction.amount) {
        transaction.status = "refunded";
      } else {
        transaction.status = "partially_refunded";
      }
      await transaction.save();
    }
  }

  await auditService.logDispute("dispute.resolve", dispute, req.user, {
    resolutionType,
    refundAmount,
  });

  res.json({
    success: true,
    message: "Dispute resolved successfully",
    data: dispute,
  });
});

// Reject dispute (admin)
// POST /api/disputes/:id/reject
const rejectDispute = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const dispute = await Dispute.findById(req.params.id);

  if (!dispute) {
    throw ApiError.notFound("Dispute not found");
  }

  if (["resolved", "rejected"].includes(dispute.status)) {
    throw ApiError.badRequest("Dispute already closed");
  }

  dispute.status = "rejected";
  dispute.rejection = {
    reason,
    rejectedBy: req.user.userId,
    rejectedAt: new Date(),
  };

  dispute.timeline.push({
    action: "Dispute rejected",
    actor: req.user.userId,
    details: reason,
  });

  await dispute.save();

  await auditService.logDispute("dispute.reject", dispute, req.user, {
    reason,
  });

  res.json({
    success: true,
    message: "Dispute rejected",
    data: dispute,
  });
});

// Get dispute statistics (admin)
// GET /api/disputes/stats
const getDisputeStats = asyncHandler(async (req, res) => {
  const stats = await Dispute.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        openCount: { $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] } },
        investigatingCount: {
          $sum: { $cond: [{ $eq: ["$status", "investigating"] }, 1, 0] },
        },
        resolvedCount: {
          $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] },
        },
        rejectedCount: {
          $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] },
        },
        totalAmount: { $sum: "$amount" },
        avgResolutionTime: {
          $avg: { $subtract: ["$resolution.resolvedAt", "$createdAt"] },
        },
      },
    },
  ]);

  const typeDistribution = await Dispute.aggregate([
    { $group: { _id: "$type", count: { $sum: 1 } } },
  ]);

  const urgentDisputes = await Dispute.countDocuments({
    status: { $in: ["open", "investigating"] },
    priority: "urgent",
  });

  res.json({
    success: true,
    data: {
      summary: stats[0] || {
        total: 0,
        openCount: 0,
        investigatingCount: 0,
        resolvedCount: 0,
        rejectedCount: 0,
        totalAmount: 0,
      },
      typeDistribution,
      urgentDisputes,
    },
  });
});
module.exports = {
  createDispute,
  getDisputes,
  getDispute,
  updateDispute,
  resolveDispute,
  rejectDispute,
  getDisputeStats,
};
