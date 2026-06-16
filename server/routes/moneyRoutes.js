const express = require('express');
const router  = express.Router();
const moneyController    = require('../controllers/moneyController');
const rechargeController = require('../controllers/rechargeController');
const auth = require('../middleware/authMiddleware');

// --- LECTURE ---
router.get('/balance',               auth, moneyController.getBalance);
router.get('/all-katikas',           auth, moneyController.getAllKatikas);
router.get('/club-players/:club_id', auth, moneyController.getClubPlayers);

// --- TRANSFERT ---
router.post('/transfer', auth, moneyController.transferFunds);

// --- RECHARGES ---
router.post('/recharge',             auth, rechargeController.createRecharge);
router.get('/recharges',             auth, rechargeController.listRecharges);
router.put('/recharges/:id/approve', auth, rechargeController.approveRecharge);
router.put('/recharges/:id/reject',  auth, rechargeController.rejectRecharge);

module.exports = router;
