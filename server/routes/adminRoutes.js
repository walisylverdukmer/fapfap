const express    = require('express');
const router     = express.Router();
const adminController = require('../controllers/adminController');
const auth        = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');

// Métriques globales
router.get('/stats',                   auth, requireRole('superadmin'),           adminController.getStats);

// Lecture
router.get('/users',                   auth, requireRole('superadmin', 'katika'), adminController.getUsers);
router.get('/sanctions',               auth, requireRole('superadmin', 'katika'), adminController.getSanctions);
router.get('/transactions',            auth, requireRole('superadmin'),           adminController.getTransactions);
router.get('/clubs',                   auth, requireRole('superadmin'),           adminController.getClubs);

// Gestion utilisateurs
router.put('/users/:id/suspend',       auth, requireRole('superadmin', 'katika'), adminController.suspendUser);
router.put('/users/:id/unsuspend',     auth, requireRole('superadmin', 'katika'), adminController.unsuspendUser);
router.put('/users/:id/ban',           auth, requireRole('superadmin'),           adminController.banUser);
router.put('/users/:id/wallet',        auth, requireRole('superadmin'),           adminController.adjustWallet);

module.exports = router;
