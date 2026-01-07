const express = require('express');
const router = express.Router();
const {
    getPlatformStats,
    getAllUsers,
    getPendingOrganizers,
    approveOrganizer,
    rejectOrganizer,
    createOrganizerSubaccount,
    getBanks,
    assignValidatorToEvent,
    updateUserRole
} = require('../controllers/adminController');
const { auth } = require('../middleware/auth');
const { roleAuth } = require('../middleware/roleAuth');

// All admin routes require admin role
router.use(auth, roleAuth(['admin']));

// Dashboard stats
router.get('/stats', getPlatformStats);

// User management
router.get('/users', getAllUsers);
router.put('/users/:id/role', updateUserRole);

// Organizer approval
router.get('/organizers/pending', getPendingOrganizers);
router.post('/organizers/:id/approve', approveOrganizer);
router.post('/organizers/:id/reject', rejectOrganizer);
router.post('/organizers/:id/create-subaccount', createOrganizerSubaccount);

// Banks (for subaccount creation)
router.get('/banks', getBanks);

// Validator assignment
router.post('/validators/:userId/assign', assignValidatorToEvent);

module.exports = router;
