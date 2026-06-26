const express = require('express');
const router  = express.Router();
const moneyController      = require('../controllers/moneyController');
const rechargeController   = require('../controllers/rechargeController');
const withdrawalController = require('../controllers/withdrawalController');
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

// --- RETRAITS WAVE ---
router.post('/withdrawals',              auth, withdrawalController.create);
router.get ('/withdrawals',              auth, withdrawalController.list);
router.put ('/withdrawals/:id/validate', auth, withdrawalController.validate);
router.put ('/withdrawals/:id/reject',   auth, withdrawalController.reject);
router.put ('/withdrawals/:id/pay',      auth, withdrawalController.markPaid);

module.exports = router;
