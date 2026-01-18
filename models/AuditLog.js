const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      enum: [
        "user.register",
        "user.login",
        "user.logout",
        "user.password_change",
        "user.profile_update",
        "user.role_change",

        "event.create",
        "event.update",
        "event.publish",
        "event.cancel",
        "event.delete",
        "event.get",

        "order.create",
        "order.payment_complete",
        "order.payment_fail",
        "order.refund",

        "ticket.create",
        "ticket.validate",
        "ticket.cancel",
        "ticket.transfer",

        "transaction.initiate",
        "transaction.process",
        "transaction.complete",
        "transaction.fail",
        "transaction.retry",
        "transaction.refund",
        "transaction.webhook_complete",
        "transaction.webhook_fail",

        "dispute.create",
        "dispute.update",
        "dispute.assign",
        "dispute.resolve",
        "dispute.reject",

        "admin.organizer_approve",
        "admin.organizer_reject",
        "admin.subaccount_create",
        "admin.validator_assign",
        "admin.reconciliation_run",

        "system.error",
        "system.maintenance",

        "other",
      ],
    },

    actor: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      email: { type: String },
      role: { type: String },
      isSystem: { type: Boolean, default: false },
    },

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
      name: { type: String },
    },

    changes: {
      before: { type: mongoose.Schema.Types.Mixed },
      after: { type: mongoose.Schema.Types.Mixed },
      changedFields: [{ type: String }],
    },

    request: {
      ipAddress: { type: String },
      userAgent: { type: String },
      endpoint: { type: String },
      method: { type: String },
    },

    result: {
      success: { type: Boolean, default: true },
      errorMessage: { type: String },
      errorCode: { type: String },
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },

    severity: {
      type: String,
      enum: ["info", "warning", "error", "critical"],
      default: "info",
    },
  },
  {
    timestamps: true,
  }
);

auditLogSchema.index({ "actor.userId": 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ "entity.type": 1, "entity.id": 1 });
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ severity: 1, createdAt: -1 });

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

auditLogSchema.statics.getUserActivity = function (userId, limit = 50) {
  return this.find({ "actor.userId": userId })
    .sort({ createdAt: -1 })
    .limit(limit);
};

auditLogSchema.statics.getRecentErrors = function (hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return this.find({
    "result.success": false,
    createdAt: { $gte: since },
  }).sort({ createdAt: -1 });
};

module.exports = mongoose.model("AuditLog", auditLogSchema);
