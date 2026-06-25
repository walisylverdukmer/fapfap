const db = require('../config/db');

/**
 * Insère une notification en base et la diffuse via Socket.IO à la bonne salle.
 *
 * @param {object} pool        — instance pg.Pool (ou db de config/db.js)
 * @param {object} io          — instance Socket.IO Server
 * @param {object} opts
 * @param {string} opts.type       — valeur du type ENUM (ex: 'nouvelle_inscription')
 * @param {string} opts.audience   — 'all_admin' | 'wali' | 'katika' | 'player'
 * @param {string} opts.title
 * @param {string} [opts.body]
 * @param {number} [opts.clubId]
 * @param {number} [opts.actorId]
 * @param {number} [opts.subjectId]
 * @param {object} [opts.metadata]
 * @param {string} [opts.playerSocketId]  — socket.id du joueur destinataire (audience='player')
 * @returns {object} La ligne notification insérée
 */
async function createAndBroadcast(pool, io, {
    type, audience, title, body = null,
    clubId = null, actorId = null, subjectId = null,
    metadata = {}, playerSocketId = null
}) {
    const { rows } = await pool.query(
        `INSERT INTO notifications
            (type, audience, title, body, club_id, actor_id, subject_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [type, audience, title, body, clubId, actorId, subjectId, JSON.stringify(metadata)]
    );
    const notif = rows[0];

    if (audience === 'player' && playerSocketId) {
        io.to(playerSocketId).emit('notification:new', notif);
    } else if (audience === 'wali') {
        io.to('wali_room').emit('notification:new', notif);
        io.to('wali_room').emit('notification:badge', { delta: 1 });
    } else if (audience === 'katika' && clubId) {
        io.to(`club_room_${clubId}`).emit('notification:new', notif);
        io.to(`club_room_${clubId}`).emit('notification:badge', { delta: 1 });
    } else {
        // all_admin : wali + tous les katika
        io.to('admin_room').emit('notification:new', notif);
        io.to('admin_room').emit('notification:badge', { delta: 1 });
    }

    return notif;
}

module.exports = { createAndBroadcast };
