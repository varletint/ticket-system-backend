const AuditLog = require("../models/AuditLog");

const getRequestContext = (req) => ({
  ipAddress: req.ip || req.connection?.remoteAddress || "unknown",
  userAgent: req.get("User-Agent") || "unknown",
  endpoint: req.originalUrl,
  method: req.method,
});

const getActorInfo = (user, isSystem = false) => ({
  userId: user?._id || user?.id,
  email: user?.email,
  role: user?.role,
  isSystem,
});

/**
 * Log an audit event
 * @param {Object} options - Audit log options
 * @param {String} options.action - The action being performed (from AuditLog enum)
 * @param {Object} options.req - Express request object
 * @param {Object} options.user - User performing the action (optional, uses req.user if not provided)
 * @param {Object} options.entity - Target entity { type, id, name }
 * @param {Object} options.changes - Changes made { before, after, changedFields }
 * @param {Object} options.result - Result of action { success, errorMessage, errorCode }
 * @param {Object} options.metadata - Additional context data
 * @param {String} options.severity - Severity level: 'info', 'warning', 'error', 'critical'
 * @param {Boolean} options.isSystem - Whether this is a system-initiated action
 * @returns {Promise<Object>} The created audit log entry
 */
const logAudit = async ({
  action,
  req,
  user,
  entity,
  changes,
  result = { success: true },
  metadata,
  severity = "info",
  isSystem = false,
}) => {
  try {
    const actor = getActorInfo(user || req?.user, isSystem);
    const request = req ? getRequestContext(req) : null;

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
    // Don't let audit logging failures break the main flow
    console.error("Audit logging failed:", error.message);
    return null;
  }
};

const logUserRegister = (req, user) =>
  logAudit({
    action: "user.register",
    req,
    user,
    entity: {
      type: "User",
      id: user._id || user.id || user.userId,
      name: user.email,
    },
    metadata: {
      role: user.role,
    },
  });

const logUserLogin = (req, user) =>
  logAudit({
    action: "user.login",
    req,
    user,
    entity: {
      type: "User",
      id: user._id,
      name: user.email,
    },
  });

const logFailedLogin = (req, email, reason) =>
  logAudit({
    action: "user.login",
    req,
    user: { email },
    entity: {
      type: "User",
      name: email,
    },
    result: {
      success: false,
      errorMessage: reason,
    },
    severity: "warning",
  });

const logUserLogout = (req, user) =>
  logAudit({
    action: "user.logout",
    req,
    user,
    entity: {
      type: "User",
      id: user._id,
      name: user.email,
    },
  });

const logPasswordChange = (req, user) =>
  logAudit({
    action: "user.password_change",
    req,
    user,
    entity: {
      type: "User",
      id: user._id,
      name: user.email,
    },
  });

const logProfileUpdate = (req, user, changes) =>
  logAudit({
    action: "user.profile_update",
    req,
    user,
    entity: {
      type: "User",
      id: user._id,
      name: user.email,
    },
    changes,
  });

const logRoleChange = (req, targetUser, oldRole, newRole, adminUser) =>
  logAudit({
    action: "user.role_change",
    req,
    user: adminUser,
    entity: {
      type: "User",
      id: targetUser._id,
      name: targetUser.email,
    },
    changes: {
      before: { role: oldRole },
      after: { role: newRole },
      changedFields: ["role"],
    },
    severity: "warning",
  });

/**
 * Log an event creation
 * @param {Object} req - Express request object
 * @param {Object} event - Event object
 */
const logCreateEvent = (req, event) =>
  logAudit({
    action: "event.create",
    req,
    user: req.user,
    entity: {
      type: "Event",
      id: event._id,
      name: event.title,
    },
  });

/**
 * Log an event update
 * @param {Object} req - Express request object
 * @param {Object} event - Event object
 * @param {Object} changes - Changes made to the event
 */

const logUpdateEvent = (req, event, changes) =>
  logAudit({
    action: "event.update",
    req,
    user: req.user,
    entity: {
      type: "Event",
      id: event._id,
      name: event.title,
    },
    changes,
  });

/**
 * Log an event deletion
 * @param {Object} req - Express request object
 * @param {Object} event - Event object
 */
const logDeleteEvent = (req, event) =>
  logAudit({
    action: "event.delete",
    req,
    user: req.user,
    entity: {
      type: "Event",
      id: event._id,
      name: event.title,
    },
  });

/**
 * Log an event retrieval
 * @param {Object} req - Express request object
 * @param {Object} event - Event object
 */
const logGetEvent = (req, event) =>
  logAudit({
    action: "event.get",
    req,
    user: req.user,
    entity: {
      type: "Event",
      id: event._id,
      name: event.title,
    },
  });

/**
 * Log an event retrieval
 * @param {Object} req - Express request object
 * @param {Object} events - Events object
 */
const logGetEvents = (req, events) =>
  logAudit({
    action: "event.get",
    req,
    user: req.user,
    entity: {
      type: "Event",
      id: events._id,
      name: events.title,
    },
  });

const logInitiateTransaction = (req, details) =>
  logAudit({
    action: "transaction.initiate",
    req,
    user: req.user,
    entity: {
      type: "Transaction",
      id: details.transactionId,
      name: details.idempotencyKey,
    },
    metadata: {
      amount: details.amount,
      status: details.status,
      ...details,
    },
    severity: details.status === "failed" ? "warning" : "info",
  });

module.exports = {
  logAudit,
  getRequestContext,
  getActorInfo,
  logUserRegister,
  logUserLogin,
  logFailedLogin,
  logUserLogout,
  logPasswordChange,
  logProfileUpdate,
  logRoleChange,
  logCreateEvent,
  logUpdateEvent,
  logDeleteEvent,
  logGetEvent,
  logGetEvents,
  logInitiateTransaction,
};
