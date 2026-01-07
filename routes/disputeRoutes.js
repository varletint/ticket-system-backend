const express = require('express');
const router = express.Router();
const disputeController = require('../controllers/disputeController');
const { auth } = require('../middleware/auth');
const { roleAuth } = require('../middleware/roleAuth');

/**
 * Dispute Routes
 * Users can create disputes, admins can manage them
 */

// Apply auth middleware to all routes
router.use(auth);

// GET /api/disputes/stats - Get dispute statistics (admin only)
router.get('/stats', roleAuth(['admin']), disputeController.getDisputeStats);

// POST /api/disputes - Create a new dispute (any authenticated user)
router.post('/', disputeController.createDispute);

// GET /api/disputes - Get disputes (users see their own, admins see all)
router.get('/', disputeController.getDisputes);

// GET /api/disputes/:id - Get single dispute
router.get('/:id', disputeController.getDispute);

// PUT /api/disputes/:id - Update dispute (admin only)
router.put('/:id', roleAuth(['admin']), disputeController.updateDispute);

// POST /api/disputes/:id/resolve - Resolve dispute (admin only)
router.post('/:id/resolve', roleAuth(['admin']), disputeController.resolveDispute);

// POST /api/disputes/:id/reject - Reject dispute (admin only)
router.post('/:id/reject', roleAuth(['admin']), disputeController.rejectDispute);

module.exports = router;
