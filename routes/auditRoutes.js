const express = require('express');
const router = express.Router();
const auditController = require('../controllers/auditController');
const { auth } = require('../middleware/auth');
const { roleAuth } = require('../middleware/roleAuth');

/**
 * Audit Routes
 * All routes require admin access
 */

// Apply auth and admin middleware to all routes
router.use(auth);
router.use(roleAuth(['admin']));

// GET /api/audit/stats - Get audit statistics
router.get('/stats', auditController.getAuditStats);

// GET /api/audit/errors - Get recent errors
router.get('/errors', auditController.getRecentErrors);

// GET /api/audit/entity/:type/:id - Get entity history
router.get('/entity/:type/:id', auditController.getEntityHistory);

// GET /api/audit/user/:userId - Get user activity
router.get('/user/:userId', auditController.getUserActivity);

// GET /api/audit - Get audit logs
router.get('/', auditController.getAuditLogs);

// GET /api/audit/:id - Get single audit log
router.get('/:id', auditController.getAuditLog);

module.exports = router;
