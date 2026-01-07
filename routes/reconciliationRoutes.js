const express = require('express');
const router = express.Router();
const reconciliationController = require('../controllers/reconciliationController');
const { auth } = require('../middleware/auth');
const { roleAuth } = require('../middleware/roleAuth');

router.use(auth);
router.use(roleAuth(['admin']));

router.get('/summary', reconciliationController.getSummary);
router.get('/mismatches', reconciliationController.getMismatches);
router.post('/fix', reconciliationController.fixMismatch);
router.post('/run', reconciliationController.runReconciliation);

module.exports = router;
