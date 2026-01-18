const express = require("express");
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
  updateUserRole,
} = require("../controllers/adminController");
const { auth } = require("../middleware/auth");
const { roleAuth } = require("../middleware/roleAuth");

router.use(auth, roleAuth(["admin"]));

router.get("/stats", getPlatformStats);

router.get("/users", getAllUsers);
router.put("/users/:id/role", updateUserRole);

router.get("/organizers/pending", getPendingOrganizers);
router.post("/organizers/:id/approve", approveOrganizer);
router.post("/organizers/:id/reject", rejectOrganizer);
router.post("/organizers/:id/create-subaccount", createOrganizerSubaccount);

router.get("/banks", getBanks);

router.post("/validators/:userId/assign", assignValidatorToEvent);

module.exports = router;
