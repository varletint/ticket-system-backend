const express = require('express');
const router = express.Router();
const {
    scanTicket,
    getEventCheckInStats,
    getValidatorEvents
} = require('../controllers/validationController');
const { auth } = require('../middleware/auth');
const { roleAuth } = require('../middleware/roleAuth');

// Validator and admin only
router.post('/scan', auth, roleAuth(['validator', 'admin']), scanTicket);
router.get('/my-events', auth, roleAuth(['validator']), getValidatorEvents);
router.get('/event/:eventId/stats', auth, roleAuth(['validator', 'organizer', 'admin']), getEventCheckInStats);

module.exports = router;
