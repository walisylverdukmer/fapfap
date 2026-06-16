const db = require('../config/db');

// GET /api/admin/users — Liste des utilisateurs filtrée par rôle
exports.getUsers = async (req, res) => {
    const { role: actorRole, club_id: actorClub } = req.user;

    try {
        let query, params;

        if (actorRole === 'superadmin') {
            query = `
                SELECT u.id, u.username, u.phone, u.role, u.status,
                       u.wallet, u.club_id, c.name AS club_name,
                       u.last_login, u.created_at
                FROM users u
                LEFT JOIN clubs c ON c.id = u.club_id
                ORDER BY u.role, u.username
            `;
            params = [];
        } else {
            // Katika : joueurs de son club uniquement
            query = `
                SELECT u.id, u.username, u.phone, u.role, u.status,
                       u.wallet, u.club_id, c.name AS club_name,
                       u.last_login, u.created_at
                FROM users u
                LEFT JOIN clubs c ON c.id = u.club_id
                WHERE u.club_id = $1 AND u.role = 'player'
                ORDER BY u.username
            `;
            params = [actorClub];
        }

        const { rows } = await db.query(query, params);
        res.json(rows.map(r => ({ ...r, wallet: parseFloat(r.wallet) })));
    } catch (err) {
        console.error("Erreur getUsers:", err);
        res.status(500).json({ error: err.message });
    }
};

// PUT /api/admin/users/:id/suspend — Suspension temporaire
exports.suspendUser = async (req, res) => {
    const actor_id   = req.user.id;
    const actor_role = req.user.role;
    const actor_club = req.user.club_id;
    const { id }     = req.params;
    const { reason } = req.body || {};

    try {
        const { rows } = await db.query(
            "SELECT id, username, role, status, club_id FROM users WHERE id=$1",
            [id]
        );
        if (rows.length === 0) return res.status(404).json({ msg: "Utilisateur introuvable." });

        const target = rows[0];

        if (target.role === 'superadmin') {
            return res.status(403).json({ msg: "Impossible de suspendre un administrateur." });
        }
        if (actor_role === 'katika') {
            if (target.role !== 'player' || target.club_id !== actor_club) {
                return res.status(403).json({ msg: "Vous ne pouvez suspendre que les joueurs de votre club." });
            }
        }
        if (target.status === 'suspended') {
            return res.status(400).json({ msg: "Ce compte est déjà suspendu." });
        }
        if (target.status === 'inactive') {
            return res.status(400).json({ msg: "Ce compte est banni. Utilisez la réactivation si nécessaire." });
        }

        const oldStatus = target.status;
        await db.query("UPDATE users SET status='suspended' WHERE id=$1", [id]);

        await db.query(`
            INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_value, new_value)
            VALUES ($1, 'suspend', 'users', $2, $3::jsonb, $4::jsonb)`,
            [actor_id, parseInt(id),
             JSON.stringify({ status: oldStatus }),
             JSON.stringify({ status: 'suspended', reason: reason || null, by_role: actor_role })
            ]
        );

        // Déconnexion immédiate si joueur en ligne
        const connectedSockets = req.app.get('connectedSockets');
        const io               = req.app.get('io');
        const socketId         = connectedSockets?.get(parseInt(id));
        if (socketId && io) {
            io.to(socketId).emit('force-disconnect', {
                reason: reason || 'Votre compte a été suspendu par un administrateur.'
            });
            io.sockets.sockets.get(socketId)?.disconnect(true);
        }

        res.json({
            msg: `Compte de ${target.username} suspendu.`,
            was_online: !!socketId
        });
    } catch (err) {
        console.error("Erreur suspendUser:", err);
        res.status(500).json({ error: err.message });
    }
};

// PUT /api/admin/users/:id/unsuspend — Réactivation
exports.unsuspendUser = async (req, res) => {
    const actor_id   = req.user.id;
    const actor_role = req.user.role;
    const actor_club = req.user.club_id;
    const { id }     = req.params;

    try {
        const { rows } = await db.query(
            "SELECT id, username, role, status, club_id FROM users WHERE id=$1",
            [id]
        );
        if (rows.length === 0) return res.status(404).json({ msg: "Utilisateur introuvable." });

        const target = rows[0];

        if (actor_role === 'katika') {
            if (target.role !== 'player' || target.club_id !== actor_club) {
                return res.status(403).json({ msg: "Vous ne pouvez gérer que les joueurs de votre club." });
            }
        }
        if (target.status === 'inactive') {
            return res.status(400).json({ msg: "Compte banni définitivement — seul le Wali peut décider." });
        }
        if (target.status === 'active') {
            return res.status(400).json({ msg: "Ce compte est déjà actif." });
        }

        const oldStatus = target.status;
        await db.query("UPDATE users SET status='active' WHERE id=$1", [id]);

        await db.query(`
            INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_value, new_value)
            VALUES ($1, 'unsuspend', 'users', $2, $3::jsonb, $4::jsonb)`,
            [actor_id, parseInt(id),
             JSON.stringify({ status: oldStatus }),
             JSON.stringify({ status: 'active', by_role: actor_role })
            ]
        );

        res.json({ msg: `Compte de ${target.username} réactivé.` });
    } catch (err) {
        console.error("Erreur unsuspendUser:", err);
        res.status(500).json({ error: err.message });
    }
};

// PUT /api/admin/users/:id/ban — Bannissement définitif (Wali seulement, status=inactive)
exports.banUser = async (req, res) => {
    const actor_id = req.user.id;
    const { id }   = req.params;
    const { reason } = req.body || {};

    try {
        const { rows } = await db.query(
            "SELECT id, username, role, status FROM users WHERE id=$1",
            [id]
        );
        if (rows.length === 0) return res.status(404).json({ msg: "Utilisateur introuvable." });

        const target = rows[0];

        if (target.role === 'superadmin') {
            return res.status(403).json({ msg: "Impossible de bannir un administrateur." });
        }
        if (target.id === actor_id) {
            return res.status(403).json({ msg: "Impossible de se bannir soi-même." });
        }
        if (target.status === 'inactive') {
            return res.status(400).json({ msg: "Ce compte est déjà banni définitivement." });
        }

        const oldStatus = target.status;
        await db.query("UPDATE users SET status='inactive' WHERE id=$1", [id]);

        await db.query(`
            INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_value, new_value)
            VALUES ($1, 'ban', 'users', $2, $3::jsonb, $4::jsonb)`,
            [actor_id, parseInt(id),
             JSON.stringify({ status: oldStatus }),
             JSON.stringify({ status: 'inactive', reason: reason || null })
            ]
        );

        // Déconnexion immédiate
        const connectedSockets = req.app.get('connectedSockets');
        const io               = req.app.get('io');
        const socketId         = connectedSockets?.get(parseInt(id));
        if (socketId && io) {
            io.to(socketId).emit('force-disconnect', {
                reason: reason || 'Votre compte a été banni définitivement.'
            });
            io.sockets.sockets.get(socketId)?.disconnect(true);
        }

        res.json({
            msg: `Compte de ${target.username} banni définitivement.`,
            was_online: !!socketId
        });
    } catch (err) {
        console.error("Erreur banUser:", err);
        res.status(500).json({ error: err.message });
    }
};

// GET /api/admin/sanctions — Historique des sanctions (audit_logs)
exports.getSanctions = async (req, res) => {
    const { role: actorRole, club_id: actorClub } = req.user;
    const SANCTION_ACTIONS = ['suspend', 'unsuspend', 'ban', 'auto_suspend_cheat'];

    try {
        let query, params;

        if (actorRole === 'superadmin') {
            query = `
                SELECT al.id, al.action, al.entity_id AS target_id,
                       al.old_value, al.new_value, al.created_at,
                       actor.username  AS actor_name,  actor.role   AS actor_role,
                       target.username AS target_name, target.role  AS target_role,
                       target.status   AS target_current_status
                FROM audit_logs al
                LEFT JOIN users actor  ON actor.id  = al.user_id
                LEFT JOIN users target ON target.id = al.entity_id
                WHERE al.action = ANY($1::text[])
                ORDER BY al.created_at DESC
                LIMIT 200
            `;
            params = [SANCTION_ACTIONS];
        } else {
            // Katika : seulement les sanctions des joueurs de son club
            query = `
                SELECT al.id, al.action, al.entity_id AS target_id,
                       al.old_value, al.new_value, al.created_at,
                       actor.username  AS actor_name,  actor.role   AS actor_role,
                       target.username AS target_name, target.role  AS target_role,
                       target.status   AS target_current_status
                FROM audit_logs al
                LEFT JOIN users actor  ON actor.id  = al.user_id
                LEFT JOIN users target ON target.id = al.entity_id
                WHERE al.action = ANY($1::text[])
                  AND target.club_id = $2
                ORDER BY al.created_at DESC
                LIMIT 50
            `;
            params = [SANCTION_ACTIONS, actorClub];
        }

        const { rows } = await db.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error("Erreur getSanctions:", err);
        res.status(500).json({ error: err.message });
    }
};
