const express = require("express");
const router = express.Router();
const {
  addSubAccount,
  getBanks,
  createValidator,
  getEventValidators,
  removeValidatorFromEvent,
} = require("../controllers/organizerController");
const { auth } = require("../middleware/auth");
const { requireApprovedOrganizer } = require("../middleware/roleAuth");

// Bank routes
router.get("/banks", getBanks);

// Payout setup
router.post("/setup-payout", auth, requireApprovedOrganizer, addSubAccount);

// Validator management for organizer's events
router.get(
  "/events/:eventId/validators",
  auth,
  requireApprovedOrganizer,
  getEventValidators
);
router.post(
  "/events/:eventId/validators",
  auth,
  requireApprovedOrganizer,
  createValidator
);
router.delete(
  "/events/:eventId/validators/:validatorId",
  auth,
  requireApprovedOrganizer,
  removeValidatorFromEvent
);

module.exports = router;
