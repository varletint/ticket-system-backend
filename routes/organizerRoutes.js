const express = require('express');
const router = express.Router();
const { addSubAccount, getBanks } = require('../controllers/organizerController');
const { auth } = require('../middleware/auth');
const { requireApprovedOrganizer } = require('../middleware/roleAuth');

router.get('/banks', getBanks);

router.post('/setup-payout', auth, requireApprovedOrganizer, addSubAccount);

module.exports = router;
