const express = require("express");
const router = express.Router();
const transactionController = require("../controllers/transactionController");
const { auth } = require("../middleware/auth");
const { roleAuth } = require("../middleware/roleAuth");

/**
 * Transaction Routes
 * All routes require authentication and admin role
 */

router.use(auth);
router.use(roleAuth(["admin"]));

router.get("/stats", transactionController.getTransactionStats);
router.get("/", transactionController.getTransactions);
router.get("/:id", transactionController.getTransaction);
router.post("/:id/retry", transactionController.retryTransaction);
router.post("/:id/refund", transactionController.refundTransaction);

module.exports = router;
