const db = require('../config/db');

// POST /api/money/recharge — Créer une demande de recharge
exports.createRecharge = async (req, res) => {
    const requester_id   = req.user.id;
    const requester_role = req.user.role;
    const requester_club = req.user.club_id;
    const { amount, target_id, note } = req.body;

    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ msg: "Montant invalide ou manquant." });
    }

    const targetId = target_id ? parseInt(target_id) : requester_id;

    try {
        const { rows: tgtRows } = await db.query(
            "SELECT id, username, club_id FROM users WHERE id = $1",
            [targetId]
        );
        if (tgtRows.length === 0) {
            return res.status(404).json({ msg: "Utilisateur cible introuvable." });
        }
        const target = tgtRows[0];

        if (requester_role === 'player' && targetId !== requester_id) {
            return res.status(403).json({ msg: "Un joueur ne peut demander une recharge que pour lui-même." });
        }
        if (requester_role === 'katika' && target.club_id !== requester_club) {
            return res.status(403).json({ msg: "Ce joueur n'appartient pas à votre club." });
        }

        const { rows: inserted } = await db.query(
            `INSERT INTO recharge_requests (requester_id, target_id, amount, status, note)
             VALUES ($1, $2, $3, 'pending', $4)
             RETURNING id, created_at`,
            [requester_id, targetId, parsedAmount, note || null]
        );
        const requestId = inserted[0].id;

        await db.query(
            `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_value)
             VALUES ($1, 'recharge_request', 'recharge_requests', $2, $3::jsonb)`,
            [requester_id, requestId, JSON.stringify({ amount: parsedAmount, target_id: targetId })]
        );

        res.status(201).json({
            msg: "Demande de recharge envoyée. En attente de validation.",
            request_id: requestId,
            created_at: inserted[0].created_at
        });
    } catch (error) {
        console.error("Erreur createRecharge:", error);
        res.status(500).json({ error: error.message });
    }
};

// GET /api/money/recharges — Lister les demandes (filtrées par rôle)
// Paramètre optionnel : ?status=pending|approved|rejected
exports.listRecharges = async (req, res) => {
    const { id: userId, role, club_id } = req.user;
    const { status } = req.query;

    try {
        let conditions = '';
        let params     = [];

        if (role === 'superadmin') {
            if (status) { conditions = "WHERE rr.status = $1"; params = [status]; }
        } else if (role === 'katika') {
            params = [club_id, userId];
            if (status) {
                conditions = "WHERE (tgt.club_id = $1 OR rr.requester_id = $2) AND rr.status = $3";
                params.push(status);
            } else {
                conditions = "WHERE (tgt.club_id = $1 OR rr.requester_id = $2)";
            }
        } else {
            params = [userId];
            if (status) {
                conditions = "WHERE (rr.requester_id = $1 OR rr.target_id = $1) AND rr.status = $2";
                params.push(status);
            } else {
                conditions = "WHERE (rr.requester_id = $1 OR rr.target_id = $1)";
            }
        }

        const { rows } = await db.query(`
            SELECT rr.id, rr.amount, rr.status, rr.note, rr.created_at, rr.reviewed_at,
                   req.username AS requester_name, req.role AS requester_role,
                   tgt.username AS target_name,
                   rev.username AS reviewer_name
            FROM recharge_requests rr
            JOIN users req ON req.id = rr.requester_id
            JOIN users tgt ON tgt.id = rr.target_id
            LEFT JOIN users rev ON rev.id = rr.reviewed_by
            ${conditions}
            ORDER BY rr.created_at DESC
            LIMIT 100
        `, params);

        res.json(rows.map(r => ({ ...r, amount: parseFloat(r.amount) })));
    } catch (error) {
        console.error("Erreur listRecharges:", error);
        res.status(500).json({ error: error.message });
    }
};

// PUT /api/money/recharges/:id/approve — Valider une demande de recharge
exports.approveRecharge = async (req, res) => {
    const reviewer_id   = req.user.id;
    const reviewer_role = req.user.role;
    const reviewer_club = req.user.club_id;
    const { id } = req.params;

    if (reviewer_role === 'player') {
        return res.status(403).json({ msg: "Seuls les Katika et le Wali peuvent valider les recharges." });
    }

    try {
        const { rows: reqRows } = await db.query(`
            SELECT rr.*, tgt.username AS target_name, tgt.club_id AS target_club
            FROM recharge_requests rr
            JOIN users tgt ON tgt.id = rr.target_id
            WHERE rr.id = $1
        `, [id]);

        if (reqRows.length === 0) return res.status(404).json({ msg: "Demande introuvable." });
        const request = reqRows[0];

        if (request.status !== 'pending') {
            return res.status(400).json({
                msg: `Demande déjà traitée (statut actuel : ${request.status}).`
            });
        }

        if (reviewer_role === 'katika' && request.target_club !== reviewer_club) {
            return res.status(403).json({ msg: "Ce joueur n'appartient pas à votre club." });
        }

        const amount = parseFloat(request.amount);

        // Débit du valideur (Katika uniquement — le Wali est illimité)
        if (reviewer_role !== 'superadmin') {
            const { rows: revRows } = await db.query(
                "SELECT wallet FROM users WHERE id = $1",
                [reviewer_id]
            );
            const revBal = parseFloat(revRows[0]?.wallet ?? 0);
            if (revBal < amount) {
                return res.status(400).json({ msg: "Solde insuffisant pour valider cette recharge." });
            }
            const revBalAfter = revBal - amount;
            await db.query("UPDATE users SET wallet = wallet - $1 WHERE id = $2", [amount, reviewer_id]);
            await db.query(`
                INSERT INTO transactions (user_id, amount, balance_before, balance_after, type, note)
                VALUES ($1, $2, $3, $4, 'transfert', $5)`,
                [reviewer_id, -amount, revBal, revBalAfter,
                 `Recharge #${id} → ${request.target_name}`]
            );
        }

        // Lecture du solde de la cible avant crédit
        const { rows: tgtRows } = await db.query(
            "SELECT wallet FROM users WHERE id = $1",
            [request.target_id]
        );
        const tgtBalBefore = parseFloat(tgtRows[0].wallet);
        const tgtBalAfter  = tgtBalBefore + amount;

        await db.query("UPDATE users SET wallet = wallet + $1 WHERE id = $2", [amount, request.target_id]);
        await db.query(`
            INSERT INTO transactions (user_id, sender_id, amount, balance_before, balance_after, type, note)
            VALUES ($1, $2, $3, $4, $5, 'recharge', $6)`,
            [request.target_id, reviewer_id, amount, tgtBalBefore, tgtBalAfter,
             `Recharge validée — demande #${id}`]
        );

        await db.query(
            "UPDATE recharge_requests SET status='approved', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2",
            [reviewer_id, id]
        );

        await db.query(`
            INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_value)
            VALUES ($1, 'recharge_approved', 'recharge_requests', $2, $3::jsonb)`,
            [reviewer_id, parseInt(id), JSON.stringify({
                amount, target: request.target_name, reviewer_role,
                balance_before: tgtBalBefore, balance_after: tgtBalAfter
            })]
        );

        res.json({
            msg: `Recharge de ${amount} FCFA approuvée pour ${request.target_name}.`,
            target: request.target_name,
            balance_after: tgtBalAfter
        });
    } catch (error) {
        console.error("Erreur approveRecharge:", error);
        res.status(500).json({ error: error.message });
    }
};

// PUT /api/money/recharges/:id/reject — Refuser une demande de recharge
exports.rejectRecharge = async (req, res) => {
    const reviewer_id   = req.user.id;
    const reviewer_role = req.user.role;
    const { id } = req.params;
    const { note } = req.body;

    if (reviewer_role === 'player') {
        return res.status(403).json({ msg: "Seuls les Katika et le Wali peuvent refuser les recharges." });
    }

    try {
        const { rows } = await db.query(
            "SELECT status FROM recharge_requests WHERE id = $1",
            [id]
        );
        if (rows.length === 0) return res.status(404).json({ msg: "Demande introuvable." });
        if (rows[0].status !== 'pending') {
            return res.status(400).json({ msg: `Demande déjà traitée (statut : ${rows[0].status}).` });
        }

        await db.query(
            "UPDATE recharge_requests SET status='rejected', reviewed_by=$1, reviewed_at=NOW(), note=COALESCE($2, note) WHERE id=$3",
            [reviewer_id, note || null, id]
        );

        await db.query(`
            INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_value)
            VALUES ($1, 'recharge_rejected', 'recharge_requests', $2, $3::jsonb)`,
            [reviewer_id, parseInt(id), JSON.stringify({ note: note || null })]
        );

        res.json({ msg: "Demande de recharge refusée." });
    } catch (error) {
        console.error("Erreur rejectRecharge:", error);
        res.status(500).json({ error: error.message });
    }
};
