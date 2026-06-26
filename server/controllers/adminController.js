const db = require('../config/db');

// GET /api/admin/stats — Métriques globales superadmin
exports.getStats = async (req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT
                COALESCE((SELECT SUM(ABS(amount)) FROM transactions WHERE type = 'mise'), 0)  AS total_volume,
                COALESCE((SELECT SUM(amount)       FROM commissions  WHERE status = 'paid'), 0) AS total_commissions,
                (SELECT COUNT(*) FROM clubs WHERE id > 0)                                       AS total_clubs,
                (SELECT COUNT(*) FROM users WHERE role = 'player' AND status = 'active')        AS total_players,
                (SELECT COUNT(*) FROM academy_wallets)                                          AS academy_players,
                COALESCE((SELECT SUM(total_granted) FROM academy_wallets), 0)                   AS total_jetons_granted
        `);
        res.json(rows[0]);
    } catch (err) {
        console.error('[getStats]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};

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

// GET /api/admin/transactions — Historique complet des transactions
exports.getTransactions = async (req, res) => {
    const limit  = Math.min(parseInt(req.query.limit  || 200), 500);
    const offset = Math.max(parseInt(req.query.offset || 0),   0);
    const type   = req.query.type || null;

    try {
        const params = type ? [limit, offset, type] : [limit, offset];
        const filter = type ? 'AND t.type::text = $3' : '';

        const { rows } = await db.query(`
            SELECT t.id, t.type, t.amount::float, t.balance_before::float,
                   t.balance_after::float, t.note, t.created_at, t.club_id,
                   u.username, u.phone, c.name AS club_name
            FROM transactions t
            JOIN  users u  ON u.id  = t.user_id
            LEFT JOIN clubs c ON c.id = t.club_id
            WHERE 1=1 ${filter}
            ORDER BY t.created_at DESC
            LIMIT $1 OFFSET $2
        `, params);

        res.json(rows);
    } catch (err) {
        console.error('[getTransactions]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};

// GET /api/admin/clubs — Liste des clubs avec stats
exports.getClubs = async (req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT c.id, c.name, c.created_at,
                   k.id         AS katika_id,
                   k.username   AS katika_name,
                   k.phone      AS katika_phone,
                   k.wallet     AS katika_wallet,
                   k.status     AS katika_status,
                   COUNT(DISTINCT u.id) FILTER (WHERE u.role='player' AND u.status='active') AS active_players,
                   COUNT(DISTINCT u.id) FILTER (WHERE u.role='player')                       AS total_players,
                   COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type='mise'), 0)              AS total_volume
            FROM clubs c
            LEFT JOIN users k  ON k.id      = c.katika_id
            LEFT JOIN users u  ON u.club_id = c.id
            LEFT JOIN transactions t ON t.club_id = c.id
            GROUP BY c.id, c.name, c.created_at, k.id, k.username, k.phone, k.wallet, k.status
            ORDER BY c.name
        `);
        res.json(rows.map(r => ({
            ...r,
            katika_wallet:  parseFloat(r.katika_wallet  || 0),
            total_volume:   parseFloat(r.total_volume   || 0),
            active_players: parseInt(r.active_players   || 0),
            total_players:  parseInt(r.total_players    || 0)
        })));
    } catch (err) {
        console.error('[getClubs]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};

// PUT /api/admin/users/:id/wallet — Ajustement manuel du solde
exports.adjustWallet = async (req, res) => {
    const { id }             = req.params;
    const { amount, note }   = req.body;
    const parsedAmount       = parseFloat(amount);

    if (!amount || isNaN(parsedAmount)) {
        return res.status(400).json({ msg: 'Montant invalide.' });
    }

    try {
        const { rows } = await db.query(
            'SELECT id, username, wallet FROM users WHERE id=$1', [id]
        );
        if (!rows[0]) return res.status(404).json({ msg: 'Utilisateur introuvable.' });

        const target       = rows[0];
        const walletBefore = parseFloat(target.wallet);
        const walletAfter  = Math.round((walletBefore + parsedAmount) * 100) / 100;

        if (walletAfter < 0) {
            return res.status(400).json({ msg: 'Ajustement impossible : le solde deviendrait négatif.' });
        }

        await db.query('UPDATE users SET wallet = wallet + $1 WHERE id = $2', [parsedAmount, id]);
        await db.query(
            `INSERT INTO transactions (user_id, amount, balance_before, balance_after, type, note)
             VALUES ($1, $2, $3, $4, 'transfert', $5)`,
            [parseInt(id), parsedAmount, walletBefore, walletAfter,
             note?.trim() || `Ajustement manuel admin (${parsedAmount >= 0 ? '+' : ''}${parsedAmount} FCFA)`]
        );
        await db.query(
            `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_value, new_value)
             VALUES ($1, 'wallet_adjust', 'users', $2, $3::jsonb, $4::jsonb)`,
            [req.user.id, parseInt(id),
             JSON.stringify({ wallet: walletBefore }),
             JSON.stringify({ wallet: walletAfter, delta: parsedAmount, note: note || null })]
        );

        res.json({
            msg:        `Solde de ${target.username} : ${walletBefore} → ${walletAfter} FCFA`,
            new_wallet: walletAfter
        });
    } catch (err) {
        console.error('[adjustWallet]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
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
