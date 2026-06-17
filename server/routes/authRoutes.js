const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

/**
 * @route   POST /api/auth/login
 * @desc    Connexion générale (Wali, Katika, ou Joueur)
 */
router.post('/login', authController.login);

/**
 * @route   POST /api/auth/check-phone
 * @desc    Vérifie si un numéro existe déjà (pour /play — sans auth)
 */
router.post('/check-phone', authController.checkPhone);

/**
 * @route   POST /api/auth/register-or-login
 * @desc    Connexion si compte existant, inscription sinon (flux /play)
 */
router.post('/register-or-login', authController.registerOrLogin);

/**
 * @route   POST /api/auth/register-katika
 * @desc    Action de Wali Sylver : Créer un gestionnaire (Katika) + son Club
 */
router.post('/register-katika', authController.registerKatika);

/**
 * @route   POST /api/auth/register-player
 * @desc    Action du Katika ou de Wali : Inscrire un joueur dans un club existant
 * C'est cette route qui débloque ton formulaire dans club-manage.html
 */
router.post('/register-player', authController.registerPlayer);

module.exports = router;