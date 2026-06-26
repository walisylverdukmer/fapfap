const express        = require('express');
const router         = express.Router();
const termsController = require('../controllers/termsController');
const auth           = require('../middleware/authMiddleware');

router.get ('/version', termsController.version);     // public
router.get ('/status',  auth, termsController.status); // auth requis
router.post('/accept',  auth, termsController.accept); // auth requis

module.exports = router;
