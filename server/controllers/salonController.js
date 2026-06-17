const db = require('../config/db');

// GET /api/salon/tables — état public du salon (sans auth)
exports.getTables = async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM v_salon_state');
        res.json(rows);
    } catch (err) {
        console.error('[salon.getTables]', err);
        res.status(500).json({ msg: 'Erreur serveur' });
    }
};

// GET /api/salon/invite/:token — résoudre un lien d'invitation
exports.getTableByToken = async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT id, name, min_bet, max_players, status
             FROM salon_tables WHERE invite_token=$1 AND status!='closed'`,
            [req.params.token]
        );
        if (!rows.length) return res.status(404).json({ msg: 'Lien invalide ou table fermée.' });
        res.json(rows[0]);
    } catch (err) {
        console.error('[salon.getTableByToken]', err);
        res.status(500).json({ msg: 'Erreur serveur' });
    }
};

// POST /api/salon/tables — créer une table (superadmin ou katika)
exports.createTable = async (req, res) => {
    const { name, min_bet, max_players } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ msg: 'Le nom de la table est requis.' });
    }
    try {
        const { rows } = await db.query(
            `INSERT INTO salon_tables (name, min_bet, max_players, created_by)
             VALUES ($1, $2, $3, $4)
             RETURNING id, name, min_bet, max_players, status, invite_token`,
            [name.trim(), min_bet || 100, max_players || 4, req.user.id]
        );
        const newTable = rows[0];

        // Notifier tous les clients connectés au salon
        const io = req.app.get('io');
        if (io) {
            const { rows: state } = await db.query('SELECT * FROM v_salon_state');
            io.emit('salon-state', state);
        }

        res.status(201).json(newTable);
    } catch (err) {
        console.error('[salon.createTable]', err);
        res.status(500).json({ msg: 'Erreur serveur' });
    }
};

// DELETE /api/salon/tables/:id — fermer une table (superadmin uniquement)
exports.closeTable = async (req, res) => {
    const tableId = parseInt(req.params.id, 10);
    if (!tableId) return res.status(400).json({ msg: 'ID invalide.' });
    try {
        const { rowCount } = await db.query(
            `UPDATE salon_tables SET status='closed' WHERE id=$1`,
            [tableId]
        );
        if (rowCount === 0) return res.status(404).json({ msg: 'Table introuvable.' });

        const io = req.app.get('io');
        if (io) {
            const { rows: state } = await db.query('SELECT * FROM v_salon_state');
            io.emit('salon-state', state);
        }

        res.json({ msg: 'Table fermée.' });
    } catch (err) {
        console.error('[salon.closeTable]', err);
        res.status(500).json({ msg: 'Erreur serveur' });
    }
};
