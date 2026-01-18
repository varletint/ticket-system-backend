const express = require("express");
const router = express.Router();
const auditController = require("../controllers/auditController");
const { auth } = require("../middleware/auth");
const { roleAuth } = require("../middleware/roleAuth");

router.use(auth);
router.use(roleAuth(["admin"]));

router.get("/stats", auditController.getAuditStats);

router.get("/errors", auditController.getRecentErrors);

router.get("/entity/:type/:id", auditController.getEntityHistory);

router.get("/user/:userId", auditController.getUserActivity);

router.get("/", auditController.getAuditLogs);

router.get("/:id", auditController.getAuditLog);

module.exports = router;
