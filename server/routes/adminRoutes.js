const express    = require('express');
const router     = express.Router();
const adminController = require('../controllers/adminController');
const auth        = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');

// Métriques globales
router.get('/stats',               auth, requireRole('superadmin'),           adminController.getStats);

// Lecture
router.get('/users',               auth, requireRole('superadmin', 'katika'), adminController.getUsers);
router.get('/sanctions',           auth, requireRole('superadmin', 'katika'), adminController.getSanctions);

// Sanctions
router.put('/users/:id/suspend',   auth, requireRole('superadmin', 'katika'), adminController.suspendUser);
router.put('/users/:id/unsuspend', auth, requireRole('superadmin', 'katika'), adminController.unsuspendUser);
router.put('/users/:id/ban',       auth, requireRole('superadmin'),           adminController.banUser);

module.exports = router;
