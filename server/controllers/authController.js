const db     = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');

// Sprint 5 — Rate limiting login (sans dépendance externe)
// Stockage en mémoire : ip → { count, firstAttempt }
const loginAttempts = new Map();
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_MAX       = 10;             // 10 tentatives max par fenêtre

function isRateLimited(ip) {
    const now   = Date.now();
    const entry = loginAttempts.get(ip);
    if (!entry || now - entry.firstAttempt > RATE_WINDOW_MS) {
        loginAttempts.set(ip, { count: 1, firstAttempt: now });
        return false;
    }
    entry.count++;
    return entry.count > RATE_MAX;
}

// Nettoyage périodique des entrées expirées (toutes les 30 min)
setInterval(() => {
    const cutoff = Date.now() - RATE_WINDOW_MS;
    for (const [ip, entry] of loginAttempts.entries()) {
        if (entry.firstAttempt < cutoff) loginAttempts.delete(ip);
    }
}, 30 * 60 * 1000);

// --- 1. CRÉATION KATIKA + CLUB (Action de Wali) ---
exports.registerKatika = async (req, res) => {
    try {
        const { username, phone, password, clubName } = req.body;

        if (!username || !phone || !password || !clubName) {
            return res.status(400).json({ msg: "Veuillez remplir tous les champs (Nom, Tel, Pass, Club)." });
        }

        const { rows: existing } = await db.query(
            "SELECT id FROM users WHERE phone = $1", [phone]
        );
        if (existing.length > 0) {
            return res.status(400).json({ msg: "Ce numéro de téléphone est déjà utilisé." });
        }

        const salt           = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const { rows: userRows } = await db.query(
            "INSERT INTO users (username, phone, password, role, wallet) VALUES ($1, $2, $3, 'katika', 0) RETURNING id",
            [username, phone, hashedPassword]
        );
        const katikaId = userRows[0].id;

        const { rows: clubRows } = await db.query(
            "INSERT INTO clubs (name, katika_id) VALUES ($1, $2) RETURNING id",
            [clubName, katikaId]
        );
        const clubId = clubRows[0].id;

        await db.query("UPDATE users SET club_id=$1 WHERE id=$2", [clubId, katikaId]);

        res.status(201).json({
            msg: `Succès : Katika ${username} recruté et Club "${clubName}" créé !`,
            katikaId,
            clubId
        });
    } catch (error) {
        console.error("ERREUR CRÉATION KATIKA:", error);
        res.status(500).json({ msg: "Erreur lors du recrutement.", detail: error.detail || error.message });
    }
};

// --- 2. CRÉATION JOUEUR (Action du Katika ou de Wali) ---
exports.registerPlayer = async (req, res) => {
    try {
        const { username, phone, password, wallet, club_id } = req.body;

        if (!username || !phone || !password || !club_id) {
            return res.status(400).json({ msg: "Données incomplètes pour le joueur." });
        }

        const { rows: existing } = await db.query(
            "SELECT id FROM users WHERE phone = $1", [phone]
        );
        if (existing.length > 0) {
            return res.status(400).json({ msg: "Ce numéro est déjà utilisé par un joueur." });
        }

        const salt           = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        await db.query(
            "INSERT INTO users (username, phone, password, role, wallet, club_id) VALUES ($1, $2, $3, 'player', $4, $5)",
            [username, phone, hashedPassword, wallet || 0, club_id]
        );

        res.status(201).json({ msg: `Joueur ${username} enregistré avec succès !` });
    } catch (error) {
        console.error("ERREUR CRÉATION JOUEUR:", error);
        res.status(500).json({ error: "Erreur lors de l'inscription." });
    }
};

// --- 3. VÉRIFICATION EXISTENCE NUMÉRO (pour /play — pas d'auth) ---
exports.checkPhone = async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ msg: 'Téléphone requis.' });
    try {
        const { rows } = await db.query('SELECT id FROM users WHERE phone=$1', [phone]);
        res.json({ exists: rows.length > 0 });
    } catch (err) {
        console.error('[checkPhone]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};

// --- 4. INSCRIPTION OU CONNEXION VIA /play (auto-detect) ---
exports.registerOrLogin = async (req, res) => {
    const { phone, username, password } = req.body;

    if (!phone || !password) {
        return res.status(400).json({ msg: 'Téléphone et mot de passe requis.' });
    }

    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    if (isRateLimited(clientIp)) {
        return res.status(429).json({ msg: 'Trop de tentatives. Réessayez dans 15 minutes.' });
    }

    try {
        const { rows: existing } = await db.query('SELECT * FROM users WHERE phone=$1', [phone]);

        if (existing.length > 0) {
            // — CONNEXION —
            const user = existing[0];
            if (user.status !== 'active') {
                return res.status(403).json({ msg: 'Compte suspendu. Contactez votre Katika.' });
            }
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(400).json({ msg: 'Mot de passe incorrect.' });
            }
            await db.query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
            const token = jwt.sign(
                { id: user.id, role: user.role, club_id: user.club_id },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );
            return res.json({
                token,
                user: { id: user.id, username: user.username, role: user.role, phone: user.phone, wallet: parseFloat(user.wallet), club_id: user.club_id },
                isNew: false
            });
        }

        // — INSCRIPTION —
        if (!username || username.trim().length < 2) {
            return res.status(400).json({ msg: 'Pseudo requis pour créer un compte (2 caractères minimum).' });
        }

        // Trouver le club Public (créé par migration 003)
        const { rows: clubs } = await db.query("SELECT id FROM clubs WHERE name='Public' LIMIT 1");
        if (!clubs.length) {
            return res.status(500).json({ msg: 'Club public non configuré. Contactez l\'administrateur.' });
        }
        const publicClubId = clubs[0].id;

        const salt           = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const { rows: newRows } = await db.query(
            `INSERT INTO users (username, phone, password, role, wallet, club_id)
             VALUES ($1, $2, $3, 'player', 0, $4)
             RETURNING id, username, role, phone, wallet, club_id`,
            [username.trim(), phone, hashedPassword, publicClubId]
        );
        const user = newRows[0];
        await db.query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);

        const token = jwt.sign(
            { id: user.id, role: user.role, club_id: user.club_id },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        return res.status(201).json({
            token,
            user: { id: user.id, username: user.username, role: user.role, phone: user.phone, wallet: parseFloat(user.wallet), club_id: user.club_id },
            isNew: true
        });

    } catch (err) {
        console.error('[registerOrLogin]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};

// --- 5. LOGIQUE DE CONNEXION GÉNÉRALE ---
exports.login = async (req, res) => {
    try {
        const { phone, password } = req.body;

        if (!phone || !password) {
            return res.status(400).json({ msg: "Téléphone et mot de passe requis." });
        }

        // Sprint 5 — Rate limiting par IP
        const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
        if (isRateLimited(clientIp)) {
            console.warn(`[RATE LIMIT] Login bloqué pour IP ${clientIp}`);
            return res.status(429).json({
                msg: "Trop de tentatives de connexion. Réessayez dans 15 minutes."
            });
        }

        const { rows: users } = await db.query(
            "SELECT * FROM users WHERE phone = $1", [phone]
        );

        if (users.length === 0) {
            return res.status(400).json({ msg: "Identifiants incorrects." });
        }

        const user = users[0];

        // BUG-06 corrigé : vérification du statut du compte
        if (user.status !== 'active') {
            return res.status(403).json({ msg: "Compte suspendu ou inactif. Contactez votre Katika." });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ msg: "Identifiants incorrects." });
        }

        await db.query("UPDATE users SET last_login=NOW() WHERE id=$1", [user.id]);

        // Sprint 5 — JWT sans fallback (JWT_SECRET vérifié au démarrage du serveur)
        const token = jwt.sign(
            { id: user.id, role: user.role, club_id: user.club_id },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id:       user.id,
                username: user.username,
                role:     user.role,
                phone:    user.phone,
                wallet:   parseFloat(user.wallet),
                club_id:  user.club_id
            }
        });
    } catch (error) {
        console.error("ERREUR LOGIN:", error);
        res.status(500).json({ error: "Erreur serveur lors de la connexion." });
    }
};
