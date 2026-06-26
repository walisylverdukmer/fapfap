const db = require('../config/db');

// Métadonnées d'affichage par type — enrichissent la réponse JSON sans stocker de redondance en DB
const TYPE_META = {
    INFO:        { color: '#3498db', icon: 'ℹ️',  priority_boost: 0 },
    TOURNAMENT:  { color: '#e67e22', icon: '🏆',  priority_boost: 3 },
    PROMOTION:   { color: '#2ecc71', icon: '🎁',  priority_boost: 2 },
    MAINTENANCE: { color: '#e74c3c', icon: '⚠️',  priority_boost: 5 },
    UPDATE:      { color: '#9b59b6', icon: '🆕',  priority_boost: 1 },
    WARNING:     { color: '#f39c12', icon: '🚨',  priority_boost: 4 }
};

function enrich(row) {
    return { ...row, meta: TYPE_META[row.announcement_type] || TYPE_META.INFO };
}

// GET /api/announcements
// Public — retourne les annonces actives non expirées visibles par tous/joueurs/académie
exports.list = async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT id, announcement_type, title, body,
                    channel_whatsapp, channel_telegram, channel_facebook,
                    channel_discord, channel_email,
                    is_active, pinned, priority, target_audience, expires_at, created_at
             FROM announcements
             WHERE is_active = true
               AND target_audience IN ('all', 'players', 'academy')
               AND (expires_at IS NULL OR expires_at > NOW())
             ORDER BY pinned DESC, priority DESC, created_at DESC
             LIMIT 20`
        );
        res.json({ announcements: rows.map(enrich) });
    } catch (err) {
        console.error('[announcement.list]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};

// GET /api/announcements/admin
// Superadmin uniquement — toutes les annonces sans filtre
exports.listAdmin = async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT a.*, u.username AS author_username
             FROM announcements a
             JOIN users u ON u.id = a.author_id
             ORDER BY a.created_at DESC
             LIMIT 100`
        );
        res.json({ announcements: rows.map(enrich) });
    } catch (err) {
        console.error('[announcement.listAdmin]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};

// POST /api/announcements
// Superadmin uniquement
exports.create = async (req, res) => {
    const {
        announcement_type = 'INFO',
        title, body,
        channel_whatsapp  = null,
        channel_telegram  = null,
        channel_facebook  = null,
        channel_discord   = null,
        channel_email     = false,
        pinned            = false,
        priority          = 0,
        target_audience   = 'all',
        expires_at        = null
    } = req.body;

    if (!title?.trim() || !body?.trim()) {
        return res.status(400).json({ msg: 'Titre et contenu requis.' });
    }

    try {
        const { rows } = await db.query(
            `INSERT INTO announcements
                (author_id, announcement_type, title, body,
                 channel_whatsapp, channel_telegram, channel_facebook,
                 channel_discord, channel_email,
                 pinned, priority, target_audience, expires_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             RETURNING *`,
            [
                req.user.id, announcement_type, title.trim(), body.trim(),
                channel_whatsapp, channel_telegram, channel_facebook,
                channel_discord, channel_email,
                pinned, priority, target_audience, expires_at || null
            ]
        );

        const announcement = enrich(rows[0]);

        // Diffuser en temps réel si visible par tous
        if (announcement.target_audience === 'all' || announcement.target_audience === 'players') {
            const io = req.app.get('io');
            if (io) io.to('salon_room').emit('announcement:new', announcement);
        }

        res.status(201).json({ announcement, msg: 'Annonce publiée.' });
    } catch (err) {
        console.error('[announcement.create]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};

// PUT /api/announcements/:id
// Superadmin uniquement
exports.update = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ msg: 'ID invalide.' });

    const {
        announcement_type, title, body,
        channel_whatsapp, channel_telegram, channel_facebook,
        channel_discord, channel_email,
        is_active, pinned, priority, target_audience, expires_at
    } = req.body;

    try {
        const { rows } = await db.query(
            `UPDATE announcements SET
                announcement_type = COALESCE($1, announcement_type),
                title             = COALESCE($2, title),
                body              = COALESCE($3, body),
                channel_whatsapp  = COALESCE($4, channel_whatsapp),
                channel_telegram  = COALESCE($5, channel_telegram),
                channel_facebook  = COALESCE($6, channel_facebook),
                channel_discord   = COALESCE($7, channel_discord),
                channel_email     = COALESCE($8, channel_email),
                is_active         = COALESCE($9, is_active),
                pinned            = COALESCE($10, pinned),
                priority          = COALESCE($11, priority),
                target_audience   = COALESCE($12, target_audience),
                expires_at        = COALESCE($13, expires_at)
             WHERE id = $14
             RETURNING *`,
            [
                announcement_type, title?.trim() || null, body?.trim() || null,
                channel_whatsapp, channel_telegram, channel_facebook,
                channel_discord, channel_email,
                is_active, pinned, priority, target_audience, expires_at || null,
                id
            ]
        );

        if (!rows.length) return res.status(404).json({ msg: 'Annonce introuvable.' });
        res.json({ announcement: enrich(rows[0]), msg: 'Annonce mise à jour.' });
    } catch (err) {
        console.error('[announcement.update]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};

// DELETE /api/announcements/:id  (soft delete — is_active = false)
// Superadmin uniquement
exports.remove = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ msg: 'ID invalide.' });

    try {
        const { rows } = await db.query(
            `UPDATE announcements SET is_active = false WHERE id = $1 RETURNING id, title`,
            [id]
        );
        if (!rows.length) return res.status(404).json({ msg: 'Annonce introuvable.' });
        res.json({ msg: `Annonce "${rows[0].title}" désactivée.` });
    } catch (err) {
        console.error('[announcement.remove]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};
