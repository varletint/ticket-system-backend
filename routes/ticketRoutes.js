const express = require("express");
const router = express.Router();
const {
  initializePurchase,
  verifyPayment,
  getMyTickets,
  getTicket,
  downloadTicket,
} = require("../controllers/ticketController");
const { auth } = require("../middleware/auth");

router.post("/purchase", auth, initializePurchase);
router.post("/verify", auth, verifyPayment);
router.get("/my-tickets", auth, getMyTickets);
router.get("/:id", auth, getTicket);
router.get("/:id/download", auth, downloadTicket);

module.exports = router;
