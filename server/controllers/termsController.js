const db = require('../config/db');

// GET /api/terms/status — Vérifier si l'utilisateur a accepté la version courante
exports.status = async (req, res) => {
    const userId = req.user.id;
    try {
        const { rows: verRows } = await db.query(
            "SELECT value FROM platform_settings WHERE key='terms_version'"
        );
        const currentVersion = verRows[0]?.value || '1.0';

        const { rows } = await db.query(
            'SELECT version, accepted_at FROM terms_acceptances WHERE user_id=$1 AND version=$2',
            [userId, currentVersion]
        );

        res.json({
            accepted:     rows.length > 0,
            version:      currentVersion,
            accepted_at:  rows[0]?.accepted_at || null
        });
    } catch (err) {
        console.error('[terms.status]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};

// POST /api/terms/accept — Enregistrer l'acceptation des CGU
exports.accept = async (req, res) => {
    const userId = req.user.id;

    try {
        const { rows: verRows } = await db.query(
            "SELECT value FROM platform_settings WHERE key='terms_version'"
        );
        const currentVersion = verRows[0]?.value || '1.0';

        await db.query(
            `INSERT INTO terms_acceptances (user_id, version, ip_address)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, version) DO NOTHING`,
            [userId, currentVersion, req.ip || null]
        );

        res.json({ msg: 'Conditions d\'utilisation acceptées.', version: currentVersion });
    } catch (err) {
        console.error('[terms.accept]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};

// GET /api/terms/version — Version courante des CGU (public — pas d'auth)
exports.version = async (req, res) => {
    try {
        const { rows } = await db.query(
            "SELECT value FROM platform_settings WHERE key='terms_version'"
        );
        res.json({ version: rows[0]?.value || '1.0' });
    } catch (err) {
        console.error('[terms.version]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};
