const roleAuth = (allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                message: 'Access denied. Insufficient permissions.',
                requiredRoles: allowedRoles,
                yourRole: req.user.role
            });
        }

        next();
    };
};

const requireApprovedOrganizer = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    if (req.user.role !== 'organizer' && req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Organizer role required' });
    }

    if (req.user.role === 'admin') {
        return next();
    }

    if (req.user.organizerProfile?.platformStatus !== 'approved') {
        return res.status(403).json({
            message: 'Organizer account not approved yet',
            status: req.user.organizerProfile?.platformStatus || 'pending'
        });
    }

    next();
};


const requirePaystackSubaccount = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    if (req.user.role === 'admin') {
        return next();
    }

    if (!req.user.organizerProfile?.paystack?.isActive) {
        return res.status(403).json({
            message: 'Paystack subaccount required. Please complete KYC.',
            hasSubaccount: false
        });
    }

    next();
};

module.exports = { roleAuth, requireApprovedOrganizer, requirePaystackSubaccount };
