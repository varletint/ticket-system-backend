const AuditLog = require('../models/AuditLog');

/**
 * Audit Controller
 * Handles audit log viewing and searching.
 */

// Get audit logs with filters
// GET /api/audit
const getAuditLogs = async (req, res) => {
    try {
        const {
            action,
            actorId,
            entityType,
            entityId,
            severity,
            startDate,
            endDate,
            page = 1,
            limit = 50
        } = req.query;

        const filter = {};

        if (action) filter.action = { $regex: action, $options: 'i' };
        if (actorId) filter['actor.userId'] = actorId;
        if (entityType) filter['entity.type'] = entityType;
        if (entityId) filter['entity.id'] = entityId;
        if (severity) filter.severity = severity;

        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) filter.createdAt.$gte = new Date(startDate);
            if (endDate) filter.createdAt.$lte = new Date(endDate);
        }

        const skip = (page - 1) * limit;

        const [logs, total] = await Promise.all([
            AuditLog.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(Number(limit))
                .populate('actor.userId', 'fullName email'),
            AuditLog.countDocuments(filter)
        ]);

        res.json({
            success: true,
            data: logs,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Get audit logs error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch audit logs' });
    }
};

// Get audit log by ID
// GET /api/audit/:id
const getAuditLog = async (req, res) => {
    try {
        const log = await AuditLog.findById(req.params.id)
            .populate('actor.userId', 'fullName email');

        if (!log) {
            return res.status(404).json({ success: false, message: 'Audit log not found' });
        }

        res.json({ success: true, data: log });
    } catch (error) {
        console.error('Get audit log error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch audit log' });
    }
};

// Get entity history
// GET /api/audit/entity/:type/:id
const getEntityHistory = async (req, res) => {
    try {
        const { type, id } = req.params;
        const { limit = 50 } = req.query;

        const logs = await AuditLog.getEntityHistory(type, id, Number(limit));

        res.json({ success: true, data: logs });
    } catch (error) {
        console.error('Get entity history error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch entity history' });
    }
};

// Get user activity
// GET /api/audit/user/:userId
const getUserActivity = async (req, res) => {
    try {
        const { userId } = req.params;
        const { limit = 50 } = req.query;

        const logs = await AuditLog.getUserActivity(userId, Number(limit));

        res.json({ success: true, data: logs });
    } catch (error) {
        console.error('Get user activity error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch user activity' });
    }
};

// Get recent errors
// GET /api/audit/errors
const getRecentErrors = async (req, res) => {
    try {
        const { hours = 24 } = req.query;

        const errors = await AuditLog.getRecentErrors(Number(hours));

        res.json({
            success: true,
            data: {
                count: errors.length,
                errors
            }
        });
    } catch (error) {
        console.error('Get recent errors error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch errors' });
    }
};

// Get audit statistics
// GET /api/audit/stats
const getAuditStats = async (req, res) => {
    try {
        const { hours = 24 } = req.query;
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);

        const stats = await AuditLog.aggregate([
            { $match: { createdAt: { $gte: since } } },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    errors: { $sum: { $cond: [{ $eq: ['$result.success', false] }, 1, 0] } },
                    info: { $sum: { $cond: [{ $eq: ['$severity', 'info'] }, 1, 0] } },
                    warnings: { $sum: { $cond: [{ $eq: ['$severity', 'warning'] }, 1, 0] } },
                    critical: { $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] } }
                }
            }
        ]);

        const actionDistribution = await AuditLog.aggregate([
            { $match: { createdAt: { $gte: since } } },
            { $group: { _id: '$action', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);

        const hourlyActivity = await AuditLog.aggregate([
            { $match: { createdAt: { $gte: since } } },
            {
                $group: {
                    _id: { $hour: '$createdAt' },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        res.json({
            success: true,
            data: {
                summary: stats[0] || { total: 0, errors: 0, info: 0, warnings: 0, critical: 0 },
                topActions: actionDistribution,
                hourlyActivity
            }
        });
    } catch (error) {
        console.error('Get audit stats error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch audit stats' });
    }
};

module.exports = {
    getAuditLogs,
    getAuditLog,
    getEntityHistory,
    getUserActivity,
    getRecentErrors,
    getAuditStats
};
