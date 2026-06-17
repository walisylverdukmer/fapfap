const express     = require('express');
const router      = express.Router();
const salon       = require('../controllers/salonController');
const auth        = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');

// Public — pas d'auth pour afficher le salon
router.get('/tables',          salon.getTables);
router.get('/invite/:token',   salon.getTableByToken);

// Auth requise
router.post('/tables',         auth, requireRole('superadmin', 'katika'), salon.createTable);
router.delete('/tables/:id',   auth, requireRole('superadmin'),           salon.closeTable);

module.exports = router;
