const express = require("express");
const router = express.Router();
const disputeController = require("../controllers/disputeController");
const { auth } = require("../middleware/auth");
const { roleAuth } = require("../middleware/roleAuth");

/**
 * Dispute Routes
 * Users can create disputes, admins can manage them
 */

router.use(auth);
router.get("/stats", roleAuth(["admin"]), disputeController.getDisputeStats);
router.post("/", disputeController.createDispute);
router.get("/", disputeController.getDisputes);
router.get("/:id", disputeController.getDispute);
router.put("/:id", roleAuth(["admin"]), disputeController.updateDispute);
router.post(
  "/:id/resolve",
  roleAuth(["admin"]),
  disputeController.resolveDispute
);
router.post(
  "/:id/reject",
  roleAuth(["admin"]),
  disputeController.rejectDispute
);

module.exports = router;
