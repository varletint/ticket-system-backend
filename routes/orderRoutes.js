const express = require("express");
const router = express.Router();
const { getMyOrders, retryPayment } = require("../controllers/orderController");
const { auth } = require("../middleware/auth");

router.get("/", auth, getMyOrders);
router.post("/:id/retry", auth, retryPayment);

module.exports = router;
