const User = require('../models/User');
const Event = require('../models/Event');
const Order = require('../models/Order');
const Ticket = require('../models/Ticket');
const paystackService = require('../services/paystackService');

/**
 * Get platform statistics (admin only)
 * GET /api/admin/stats
 */
const getPlatformStats = async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const usersByRole = await User.aggregate([
            { $group: { _id: '$role', count: { $sum: 1 } } }
        ]);

        const totalEvents = await Event.countDocuments();
        const eventsByStatus = await Event.aggregate([
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]);

        const totalOrders = await Order.countDocuments({ paymentStatus: 'completed' });
        const totalRevenue = await Order.aggregate([
            { $match: { paymentStatus: 'completed' } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);

        const pendingOrganizers = await User.countDocuments({
            role: 'organizer',
            'organizerProfile.platformStatus': 'pending'
        });

        res.json({
            users: {
                total: totalUsers,
                byRole: Object.fromEntries(usersByRole.map(r => [r._id, r.count]))
            },
            events: {
                total: totalEvents,
                byStatus: Object.fromEntries(eventsByStatus.map(e => [e._id, e.count]))
            },
            orders: {
                total: totalOrders,
                revenue: totalRevenue[0]?.total || 0
            },
            pendingApprovals: {
                organizers: pendingOrganizers
            }
        });
    } catch (error) {
        console.error('Get platform stats error:', error);
        res.status(500).json({ message: 'Error fetching statistics' });
    }
};

/**
 * Get all users (admin only)
 * GET /api/admin/users
 */
const getAllUsers = async (req, res) => {
    try {
        const { role, status, page = 1, limit = 20 } = req.query;

        const query = {};
        if (role) query.role = role;
        if (status) query['organizerProfile.platformStatus'] = status;

        const users = await User.find(query)
            .select('-password -refreshToken')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        const total = await User.countDocuments(query);

        res.json({
            users,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Get all users error:', error);
        res.status(500).json({ message: 'Error fetching users' });
    }
};

/**
 * Get pending organizer approvals
 * GET /api/admin/organizers/pending
 */
const getPendingOrganizers = async (req, res) => {
    try {
        const organizers = await User.find({
            role: 'organizer',
            'organizerProfile.platformStatus': 'pending'
        }).select('-password -refreshToken');

        res.json({ organizers });
    } catch (error) {
        console.error('Get pending organizers error:', error);
        res.status(500).json({ message: 'Error fetching pending organizers' });
    }
};

/**
 * Approve organizer (admin only)
 * POST /api/admin/organizers/:id/approve
 */
const approveOrganizer = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.role !== 'organizer') {
            return res.status(400).json({ message: 'User is not an organizer' });
        }

        user.organizerProfile.platformStatus = 'approved';
        user.organizerProfile.platformApprovedBy = req.user._id;
        user.organizerProfile.platformApprovedAt = new Date();

        await user.save();

        res.json({
            message: 'Organizer approved successfully',
            user: {
                id: user._id,
                fullName: user.fullName,
                status: user.organizerProfile.platformStatus
            }
        });
    } catch (error) {
        console.error('Approve organizer error:', error);
        res.status(500).json({ message: 'Error approving organizer' });
    }
};

/**
 * Reject organizer (admin only)
 * POST /api/admin/organizers/:id/reject
 */
const rejectOrganizer = async (req, res) => {
    try {
        const { reason } = req.body;
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        user.organizerProfile.platformStatus = 'rejected';
        user.organizerProfile.platformRejectionReason = reason;
        user.organizerProfile.platformApprovedBy = req.user._id;
        user.organizerProfile.platformApprovedAt = new Date();

        await user.save();

        res.json({
            message: 'Organizer rejected',
            user: {
                id: user._id,
                fullName: user.fullName,
                status: user.organizerProfile.platformStatus
            }
        });
    } catch (error) {
        console.error('Reject organizer error:', error);
        res.status(500).json({ message: 'Error rejecting organizer' });
    }
};

/**
 * Create Paystack subaccount for organizer (after approval)
 * POST /api/admin/organizers/:id/create-subaccount
 */
const createOrganizerSubaccount = async (req, res) => {
    try {
        const { bankCode, accountNumber, businessName, percentageCharge } = req.body;
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.organizerProfile?.platformStatus !== 'approved') {
            return res.status(400).json({ message: 'Organizer must be approved first' });
        }

        // Create subaccount in Paystack
        const result = await paystackService.createSubaccount(user, {
            bankCode,
            accountNumber,
            businessName: businessName || user.organizerProfile.businessName || user.fullName,
            percentageCharge: percentageCharge || 90
        });

        if (!result.success) {
            return res.status(500).json({ message: 'Failed to create subaccount' });
        }

        // Update user
        user.organizerProfile.paystack = {
            subaccountCode: result.data.subaccount_code,
            businessName: result.data.business_name,
            bankCode,
            accountNumber,
            percentageCharge: result.data.percentage_charge,
            isActive: true
        };

        await user.save();

        res.json({
            message: 'Subaccount created successfully',
            subaccount: user.organizerProfile.paystack
        });
    } catch (error) {
        console.error('Create subaccount error:', error);
        res.status(500).json({ message: 'Error creating subaccount' });
    }
};

/**
 * Get list of banks (for subaccount creation)
 * GET /api/admin/banks
 */
const getBanks = async (req, res) => {
    try {
        const result = await paystackService.getBanks();
        res.json(result);
    } catch (error) {
        console.error('Get banks error:', error);
        res.status(500).json({ message: 'Error fetching banks' });
    }
};

/**
 * Assign validator to event
 * POST /api/admin/validators/:userId/assign
 */
const assignValidatorToEvent = async (req, res) => {
    try {
        const { eventId } = req.body;
        const user = await User.findById(req.params.userId);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.role !== 'validator') {
            return res.status(400).json({ message: 'User is not a validator' });
        }

        const event = await Event.findById(eventId);
        if (!event) {
            return res.status(404).json({ message: 'Event not found' });
        }

        // Add to user's assigned events
        if (!user.assignedEvents.includes(eventId)) {
            user.assignedEvents.push(eventId);
            await user.save();
        }

        // Add to event's validators
        if (!event.validators.includes(user._id)) {
            event.validators.push(user._id);
            await event.save();
        }

        res.json({
            message: 'Validator assigned to event',
            validator: user.fullName,
            event: event.title
        });
    } catch (error) {
        console.error('Assign validator error:', error);
        res.status(500).json({ message: 'Error assigning validator' });
    }
};

/**
 * Update user role (admin only)
 * PUT /api/admin/users/:id/role
 */
const updateUserRole = async (req, res) => {
    try {
        const { role } = req.body;
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const validRoles = ['buyer', 'organizer', 'validator', 'admin'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ message: 'Invalid role' });
        }

        user.role = role;

        // Initialize organizer profile if becoming organizer
        if (role === 'organizer' && !user.organizerProfile) {
            user.organizerProfile = { platformStatus: 'pending' };
        }

        await user.save();

        res.json({
            message: 'User role updated',
            user: {
                id: user._id,
                fullName: user.fullName,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Update user role error:', error);
        res.status(500).json({ message: 'Error updating user role' });
    }
};

module.exports = {
    getPlatformStats,
    getAllUsers,
    getPendingOrganizers,
    approveOrganizer,
    rejectOrganizer,
    createOrganizerSubaccount,
    getBanks,
    assignValidatorToEvent,
    updateUserRole
};
