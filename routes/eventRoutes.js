const express = require("express");
const router = express.Router();
const {
  getEvents,
  getEvent,
  createEvent,
  updateEvent,
  publishEvent,
  cancelEvent,
  getMyEvents,
  getEventAnalytics,
} = require("../controllers/eventController");
const { auth, optionalAuth } = require("../middleware/auth");
const {
  roleAuth,
  requireApprovedOrganizer,
  requirePaystackSubaccount,
} = require("../middleware/roleAuth");
const {
  validateCreateEvent,
  validateUpdateEvent,
  validateObjectId,
} = require("../middleware/validation");

// Public routes
router.get("/", getEvents);
router.get("/:id", validateObjectId("id"), getEvent);

// Organizer routes
router.get(
  "/organizer/my-events",
  auth,
  roleAuth(["organizer", "admin"]),
  getMyEvents
);
router.post(
  "/",
  auth,
  roleAuth(["organizer", "admin"]),
  validateCreateEvent,
  createEvent
);
router.put(
  "/:id",
  auth,
  roleAuth(["organizer", "admin"]),
  validateObjectId("id"),
  validateUpdateEvent,
  updateEvent
);
router.post(
  "/:id/publish",
  auth,
  requireApprovedOrganizer,
  requirePaystackSubaccount,
  validateObjectId("id"),
  publishEvent
);
router.post(
  "/:id/cancel",
  auth,
  roleAuth(["organizer", "admin"]),
  validateObjectId("id"),
  cancelEvent
);
router.get(
  "/:id/analytics",
  auth,
  roleAuth(["organizer", "admin"]),
  validateObjectId("id"),
  getEventAnalytics
);

module.exports = router;
