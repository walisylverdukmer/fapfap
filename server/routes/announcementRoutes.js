const express      = require('express');
const router       = express.Router();
const auth         = require('../middleware/authMiddleware');
const requireRole  = require('../middleware/requireRole');
const ann          = require('../controllers/announcementController');

// Public — visible dans le salon pour tous les visiteurs
router.get('/',        ann.list);

// Admin — liste complète sans filtre
router.get('/admin',   auth, requireRole('superadmin'), ann.listAdmin);

// CRUD — superadmin uniquement
router.post('/',       auth, requireRole('superadmin'), ann.create);
router.put('/:id',     auth, requireRole('superadmin'), ann.update);
router.delete('/:id',  auth, requireRole('superadmin'), ann.remove);

module.exports = router;
