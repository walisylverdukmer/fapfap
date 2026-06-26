const express    = require('express');
const router     = express.Router();
const auth       = require('../middleware/authMiddleware');
const academy    = require('../controllers/academyController');

router.get('/wallet',                auth, academy.getWallet);
router.post('/daily-grant',          auth, academy.claimDaily);
router.get('/history',               auth, academy.getHistory);
router.get('/leaderboard/:period',   auth, academy.getLeaderboard);

module.exports = router;
