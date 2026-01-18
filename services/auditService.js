const AuditLog = require("../models/AuditLog");

const log = async ({
  action,
  actor,
  entity,
  changes = {},
  request = {},
  result = { success: true },
  metadata = {},
  severity = "info",
}) => {
  try {
    return await AuditLog.log({
      action,
      actor,
      entity,
      changes,
      request,
      result,
      metadata,
      severity,
    });
  } catch (error) {
    console.error("Audit logging failed:", error.message);
    return null;
  }
};

const auditMiddleware = (actionName, options = {}) => {
  return async (req, res, next) => {
    const originalSend = res.send;
    const startTime = Date.now();

    res.send = function (body) {
      res.send = originalSend;

      const success = res.statusCode < 400;
      log({
        action: actionName,
        actor: req.user || { isSystem: false },
        entity: options.entity || {},
        request: {
          ipAddress: req.ip || req.connection?.remoteAddress,
          userAgent: req.get("user-agent"),
          endpoint: req.originalUrl,
          method: req.method,
        },
        result: {
          success,
          errorMessage: success ? undefined : body?.message,
        },
        metadata: {
          responseTime: Date.now() - startTime,
          statusCode: res.statusCode,
        },
        severity: success ? "info" : "warning",
      });

      return originalSend.call(this, body);
    };

    next();
  };
};

const logUserAction = async (action, user, details = {}) => {
  return log({
    action,
    actor: user,
    entity: {
      type: "User",
      id: user._id || user.userId,
      name: user.email,
    },
    metadata: details,
    severity: "info",
  });
};

const logTransaction = async (action, transaction, actor, details = {}) => {
  return log({
    action,
    actor,
    entity: {
      type: "Transaction",
      id: transaction._id,
      name: transaction.idempotencyKey,
    },
    metadata: {
      amount: transaction.amount,
      status: transaction.status,
      ...details,
    },
    severity: action.includes("fail") ? "warning" : "info",
  });
};

const logDispute = async (action, dispute, actor, details = {}) => {
  return log({
    action,
    actor,
    entity: {
      type: "Dispute",
      id: dispute._id,
      name: dispute.disputeNumber,
    },
    metadata: {
      type: dispute.type,
      status: dispute.status,
      amount: dispute.amount,
      ...details,
    },
    severity: dispute.priority === "urgent" ? "warning" : "info",
  });
};

const logAdminAction = async (action, actor, entity, details = {}) => {
  return log({
    action,
    actor,
    entity,
    metadata: details,
    severity: "info",
  });
};

const logError = async (error, request = {}, actor = null) => {
  return log({
    action: "system.error",
    actor: actor || { isSystem: true },
    entity: {
      type: "System",
      name: "Error",
    },
    result: {
      success: false,
      errorMessage: error.message,
      errorCode: error.code,
    },
    request,
    metadata: {
      stack: error.stack,
    },
    severity: "error",
  });
};

module.exports = {
  log,
  auditMiddleware,
  logUserAction,
  logTransaction,
  logDispute,
  logAdminAction,
  logError,
};
