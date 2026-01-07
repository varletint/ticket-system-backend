const mongoose = require("mongoose");

/**
 * AuditLog Model
 * Comprehensive audit trail for compliance and debugging.
 * Logs all significant actions with before/after snapshots.
 */
const auditLogSchema = new mongoose.Schema(
  {
    // Action classification
    action: {
      type: String,
      required: true,
      enum: [
        // User actions
        "user.register",
        "user.login",
        "user.logout",
        "user.password_change",
        "user.profile_update",
        "user.role_change",

        // Event actions
        "event.create",
        "event.update",
        "event.publish",
        "event.cancel",
        "event.delete",
        "event.get",

        // Order actions
        "order.create",
        "order.payment_complete",
        "order.payment_fail",
        "order.refund",

        // Ticket actions
        "ticket.create",
        "ticket.validate",
        "ticket.cancel",
        "ticket.transfer",

        // Transaction actions
        "transaction.initiate",
        "transaction.process",
        "transaction.complete",
        "transaction.fail",
        "transaction.retry",
        "transaction.refund",

        // Dispute actions
        "dispute.create",
        "dispute.update",
        "dispute.assign",
        "dispute.resolve",
        "dispute.reject",

        // Admin actions
        "admin.organizer_approve",
        "admin.organizer_reject",
        "admin.subaccount_create",
        "admin.validator_assign",
        "admin.reconciliation_run",

        // System actions
        "system.error",
        "system.maintenance",

        // Generic
        "other",
      ],
    },

    // Actor (who performed the action)
    actor: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      email: { type: String },
      role: { type: String },
      isSystem: { type: Boolean, default: false },
    },

    // Target entity
    entity: {
      type: {
        type: String,
        enum: [
          "User",
          "Event",
          "Order",
          "Ticket",
          "Transaction",
          "Dispute",
          "System",
        ],
      },
      id: { type: mongoose.Schema.Types.ObjectId },
      name: { type: String }, // Human-readable identifier
    },

    // Change details
    changes: {
      before: { type: mongoose.Schema.Types.Mixed },
      after: { type: mongoose.Schema.Types.Mixed },
      changedFields: [{ type: String }],
    },

    // Request context
    request: {
      ipAddress: { type: String },
      userAgent: { type: String },
      endpoint: { type: String },
      method: { type: String },
    },

    // Result
    result: {
      success: { type: Boolean, default: true },
      errorMessage: { type: String },
      errorCode: { type: String },
    },

    // Additional context
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },

    // Severity level for filtering
    severity: {
      type: String,
      enum: ["info", "warning", "error", "critical"],
      default: "info",
    },
  },
  {
    timestamps: true,
    // Automatically delete logs after 90 days (optional)
    // expires: 7776000 // 90 days in seconds
  }
);

// Indexes for efficient querying
auditLogSchema.index({ "actor.userId": 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ "entity.type": 1, "entity.id": 1 });
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ severity: 1, createdAt: -1 });

// Static method to log an action
auditLogSchema.statics.log = async function ({
  action,
  actor,
  entity,
  changes,
  request,
  result,
  metadata,
  severity = "info",
}) {
  const log = new this({
    action,
    actor: {
      userId: actor?.userId || actor?._id || actor.id,
      email: actor?.email,
      role: actor?.role,
      isSystem: actor?.isSystem || false,
    },
    entity,
    changes,
    request,
    result,
    metadata,
    severity,
  });

  return log.save();
};

// Static method to get logs for an entity
auditLogSchema.statics.getEntityHistory = function (
  entityType,
  entityId,
  limit = 50
) {
  return this.find({
    "entity.type": entityType,
    "entity.id": entityId,
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("actor.userId", "fullName email");
};

// Static method to get logs for a user
auditLogSchema.statics.getUserActivity = function (userId, limit = 50) {
  return this.find({ "actor.userId": userId })
    .sort({ createdAt: -1 })
    .limit(limit);
};

// Static method to get recent errors
auditLogSchema.statics.getRecentErrors = function (hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return this.find({
    "result.success": false,
    createdAt: { $gte: since },
  }).sort({ createdAt: -1 });
};

module.exports = mongoose.model("AuditLog", auditLogSchema);
