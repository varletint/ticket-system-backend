const express = require('express');
const router = express.Router();
const { register, login, refreshToken, getMe, logout, updateUserProfile } = require('../controllers/authController');
const { auth } = require('../middleware/auth');


router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refreshToken);

router.get('/me', auth, getMe);
router.put('/profile', auth, updateUserProfile);
router.post('/logout', auth, logout);

module.exports = router;
