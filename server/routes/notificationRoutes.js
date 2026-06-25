const express  = require('express');
const router   = express.Router();
const auth        = require('../middleware/authMiddleware');
const notifCtrl   = require('../controllers/notificationController');
const requireRole = require('../middleware/requireRole');

const adminOnly = requireRole('superadmin', 'katika');

// Lecture
router.get('/',              auth, adminOnly, notifCtrl.list);
router.get('/unread-count',  auth, adminOnly, notifCtrl.unreadCount);

// Marquer comme lu
router.put('/read-all',      auth, adminOnly, notifCtrl.markAllRead);
router.put('/:id/read',      auth, adminOnly, notifCtrl.markRead);

module.exports = router;
