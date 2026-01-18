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

router.get("/banks", getBanks);

router.post("/setup-payout", auth, requireApprovedOrganizer, addSubAccount);

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
