const db = require('../config/db');

// Construit la clause WHERE selon l'audience de l'admin connecté
function buildAudienceFilter(role, clubId) {
    if (role === 'superadmin') {
        return { clause: "AND n.audience IN ('all_admin','wali')", params: [] };
    }
    // katika : voit les notifs de son club (audience katika + all_admin)
    return {
        clause: "AND (n.audience = 'all_admin' OR (n.audience = 'katika' AND n.club_id = $__CLUB__))",
        params: [clubId]
    };
}

// GET /api/notifications?limit=50&offset=0
exports.list = async (req, res) => {
    const { id: userId, role, club_id } = req.user;
    const limit  = Math.min(parseInt(req.query.limit  || '50', 10), 100);
    const offset = parseInt(req.query.offset || '0', 10);

    const { clause, params } = buildAudienceFilter(role, club_id);
    const clauseFixed = clause.replace('$__CLUB__', `$${params.length + 1}`);

    try {
        const { rows } = await db.query(`
            SELECT
                n.id, n.type, n.audience, n.title, n.body,
                n.club_id, n.actor_id, n.subject_id, n.metadata, n.created_at,
                ua.username AS actor_username,
                us.username AS subject_username,
                EXISTS (
                    SELECT 1 FROM notification_reads nr
                    WHERE nr.notification_id = n.id AND nr.user_id = $1
                ) AS is_read
            FROM notifications n
            LEFT JOIN users ua ON n.actor_id   = ua.id
            LEFT JOIN users us ON n.subject_id = us.id
            WHERE 1=1 ${clauseFixed}
            ORDER BY n.created_at DESC
            LIMIT $${params.length + 2} OFFSET $${params.length + 3}
        `, [userId, ...params, limit, offset]);

        const { rows: cnt } = await db.query(`
            SELECT COUNT(*)::int AS total,
                   SUM(CASE WHEN NOT EXISTS (
                       SELECT 1 FROM notification_reads nr
                       WHERE nr.notification_id = n.id AND nr.user_id = $1
                   ) THEN 1 ELSE 0 END)::int AS unread
            FROM notifications n
            WHERE 1=1 ${clauseFixed}
        `, [userId, ...params]);

        res.json({
            notifications: rows,
            unread_count:  cnt[0].unread,
            total:         cnt[0].total
        });
    } catch (err) {
        console.error('[notifications.list]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};

// GET /api/notifications/unread-count
exports.unreadCount = async (req, res) => {
    const { id: userId, role, club_id } = req.user;
    const { clause, params } = buildAudienceFilter(role, club_id);
    const clauseFixed = clause.replace('$__CLUB__', `$${params.length + 1}`);

    try {
        const { rows } = await db.query(`
            SELECT COUNT(*)::int AS unread
            FROM notifications n
            WHERE NOT EXISTS (
                SELECT 1 FROM notification_reads nr
                WHERE nr.notification_id = n.id AND nr.user_id = $1
            ) ${clauseFixed}
        `, [userId, ...params]);

        res.json({ unread_count: rows[0].unread });
    } catch (err) {
        console.error('[notifications.unreadCount]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};

// PUT /api/notifications/:id/read
exports.markRead = async (req, res) => {
    const userId = req.user.id;
    const { id } = req.params;

    try {
        await db.query(
            `INSERT INTO notification_reads (notification_id, user_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [parseInt(id, 10), userId]
        );
        res.json({ msg: 'Notification marquée comme lue.' });
    } catch (err) {
        console.error('[notifications.markRead]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};

// PUT /api/notifications/read-all
exports.markAllRead = async (req, res) => {
    const { id: userId, role, club_id } = req.user;
    const { clause, params } = buildAudienceFilter(role, club_id);
    const clauseFixed = clause.replace('$__CLUB__', `$${params.length + 1}`);

    try {
        const { rows: notifs } = await db.query(`
            SELECT n.id FROM notifications n
            WHERE NOT EXISTS (
                SELECT 1 FROM notification_reads nr
                WHERE nr.notification_id = n.id AND nr.user_id = $1
            ) ${clauseFixed}
        `, [userId, ...params]);

        if (notifs.length > 0) {
            const ids = notifs.map(r => r.id);
            await db.query(`
                INSERT INTO notification_reads (notification_id, user_id)
                SELECT unnest($1::int[]), $2
                ON CONFLICT DO NOTHING
            `, [ids, userId]);
        }

        // Envoyer badge = 0 via Socket.IO (server.js expose io sur app)
        const io = req.app.get('io');
        if (io) {
            io.to('admin_room').emit('notification:badge', { delta: -notifs.length });
        }

        res.json({ msg: `${notifs.length} notification(s) marquée(s) comme lues.`, count: notifs.length });
    } catch (err) {
        console.error('[notifications.markAllRead]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};
