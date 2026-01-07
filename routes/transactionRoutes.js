const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');
const { auth } = require('../middleware/auth');
const { roleAuth } = require('../middleware/roleAuth');

/**
 * Transaction Routes
 * All routes require authentication and admin role
 */

// Apply auth and admin middleware to all routes
router.use(auth);
router.use(roleAuth(['admin']));

// GET /api/transactions/stats - Get transaction statistics (must be before :id route)
router.get('/stats', transactionController.getTransactionStats);

// GET /api/transactions - Get all transactions with filters
router.get('/', transactionController.getTransactions);

// GET /api/transactions/:id - Get single transaction
router.get('/:id', transactionController.getTransaction);

// POST /api/transactions/:id/retry - Retry failed transaction
router.post('/:id/retry', transactionController.retryTransaction);

// POST /api/transactions/:id/refund - Process refund
router.post('/:id/refund', transactionController.refundTransaction);

module.exports = router;
