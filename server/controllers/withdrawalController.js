const db           = require('../config/db');
const notifService = require('../services/notificationService');

// POST /api/money/withdrawals
exports.create = async (req, res) => {
    const userId = req.user.id;
    const { amount, wave_number, wave_holder, observations } = req.body;

    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ msg: 'Montant invalide.' });
    }
    if (!wave_number?.trim()) {
        return res.status(400).json({ msg: 'Numéro Wave requis.' });
    }
    if (!wave_holder?.trim()) {
        return res.status(400).json({ msg: 'Nom du titulaire Wave requis.' });
    }

    try {
        const { rows: userRows } = await db.query(
            'SELECT wallet, username, phone FROM users WHERE id=$1', [userId]
        );
        if (!userRows[0]) return res.status(404).json({ msg: 'Utilisateur introuvable.' });
        const user = userRows[0];

        if (parseFloat(user.wallet) < parsedAmount) {
            return res.status(400).json({ msg: 'Solde insuffisant pour effectuer ce retrait.' });
        }

        const { rows: inserted } = await db.query(
            `INSERT INTO withdrawal_requests (user_id, amount, wave_number, wave_holder, observations)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, created_at`,
            [userId, parsedAmount, wave_number.trim(), wave_holder.trim(), observations?.trim() || null]
        );
        const requestId = inserted[0].id;

        await db.query(
            `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_value)
             VALUES ($1, 'withdrawal_request', 'withdrawal_requests', $2, $3::jsonb)`,
            [userId, requestId, JSON.stringify({ amount: parsedAmount, wave_number: wave_number.trim() })]
        );

        const io = req.app.get('io');
        if (io) {
            notifService.createAndBroadcast(db, io, {
                type:      'demande_retrait',
                audience:  'all_admin',
                title:     'Demande de retrait',
                body:      `${user.username} demande un retrait de ${parsedAmount.toLocaleString('fr-FR')} FCFA via Wave`,
                actorId:   userId,
                subjectId: userId,
                metadata:  { request_id: requestId, amount: parsedAmount, wave_number: wave_number.trim() }
            }).catch(e => console.error('[withdrawal.create] notif:', e.message));
        }

        res.status(201).json({
            msg: 'Demande de retrait envoyée avec succès.',
            request_id: requestId,
            created_at: inserted[0].created_at
        });
    } catch (err) {
        console.error('[withdrawal.create]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};

// GET /api/money/withdrawals
exports.list = async (req, res) => {
    const { id: userId, role } = req.user;
    const { status } = req.query;

    let conditions = '';
    let params = [];

    if (role === 'superadmin') {
        if (status) { conditions = 'WHERE wr.status=$1::withdrawal_status'; params = [status]; }
    } else {
        params = [userId];
        conditions = 'WHERE wr.user_id=$1';
        if (status) { conditions += ' AND wr.status=$2::withdrawal_status'; params.push(status); }
    }

    try {
        const { rows } = await db.query(`
            SELECT wr.id, wr.amount, wr.wave_number, wr.wave_holder,
                   wr.observations, wr.status, wr.created_at,
                   wr.reviewed_at, wr.paid_at, wr.review_note,
                   u.username, u.phone,
                   rev.username AS reviewer_name
            FROM withdrawal_requests wr
            JOIN  users u   ON u.id   = wr.user_id
            LEFT JOIN users rev ON rev.id = wr.reviewed_by
            ${conditions}
            ORDER BY wr.created_at DESC
            LIMIT 200
        `, params);

        res.json(rows.map(r => ({ ...r, amount: parseFloat(r.amount) })));
    } catch (err) {
        console.error('[withdrawal.list]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};

// PUT /api/money/withdrawals/:id/validate
exports.validate = async (req, res) => {
    if (req.user.role === 'player') {
        return res.status(403).json({ msg: 'Accès refusé.' });
    }
    const { id } = req.params;
    const reviewerId = req.user.id;

    try {
        const { rows } = await db.query(`
            SELECT wr.*, u.username, u.id AS uid
            FROM withdrawal_requests wr
            JOIN users u ON u.id = wr.user_id
            WHERE wr.id=$1
        `, [id]);

        if (!rows[0]) return res.status(404).json({ msg: 'Demande introuvable.' });
        if (rows[0].status !== 'pending') return res.status(400).json({ msg: 'Demande déjà traitée.' });
        const reqData = rows[0];

        await db.query(
            "UPDATE withdrawal_requests SET status='validated', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2",
            [reviewerId, id]
        );

        await db.query(
            `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_value)
             VALUES ($1, 'withdrawal_validated', 'withdrawal_requests', $2, $3::jsonb)`,
            [reviewerId, parseInt(id), JSON.stringify({ amount: parseFloat(reqData.amount) })]
        );

        const io = req.app.get('io');
        const connectedSockets = req.app.get('connectedSockets');
        if (io) {
            notifService.createAndBroadcast(db, io, {
                type:      'retrait_valide',
                audience:  'all_admin',
                title:     'Retrait validé',
                body:      `Retrait #${id} de ${parseFloat(reqData.amount).toLocaleString('fr-FR')} FCFA de ${reqData.username} — en attente de paiement`,
                actorId:   reviewerId,
                subjectId: reqData.uid,
                metadata:  { request_id: parseInt(id), amount: parseFloat(reqData.amount) }
            }).catch(e => console.error('[withdrawal.validate] notif:', e.message));

            const playerSocketId = connectedSockets?.get(reqData.uid);
            if (playerSocketId) {
                io.to(playerSocketId).emit('withdrawal:validated', {
                    request_id: parseInt(id),
                    amount: parseFloat(reqData.amount)
                });
            }
        }

        res.json({ msg: 'Demande de retrait validée — en attente de paiement.' });
    } catch (err) {
        console.error('[withdrawal.validate]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};

// PUT /api/money/withdrawals/:id/reject
exports.reject = async (req, res) => {
    if (req.user.role === 'player') {
        return res.status(403).json({ msg: 'Accès refusé.' });
    }
    const { id } = req.params;
    const reviewerId = req.user.id;
    const { note } = req.body;

    try {
        const { rows } = await db.query(`
            SELECT wr.*, u.id AS uid, u.username
            FROM withdrawal_requests wr
            JOIN users u ON u.id = wr.user_id
            WHERE wr.id=$1
        `, [id]);

        if (!rows[0]) return res.status(404).json({ msg: 'Demande introuvable.' });
        if (rows[0].status !== 'pending') return res.status(400).json({ msg: 'Demande déjà traitée.' });
        const reqData = rows[0];

        await db.query(
            "UPDATE withdrawal_requests SET status='rejected', reviewed_by=$1, reviewed_at=NOW(), review_note=$2 WHERE id=$3",
            [reviewerId, note?.trim() || null, id]
        );

        await db.query(
            `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_value)
             VALUES ($1, 'withdrawal_rejected', 'withdrawal_requests', $2, $3::jsonb)`,
            [reviewerId, parseInt(id), JSON.stringify({ note: note || null })]
        );

        const io = req.app.get('io');
        const connectedSockets = req.app.get('connectedSockets');
        if (io) {
            notifService.createAndBroadcast(db, io, {
                type:      'retrait_refuse',
                audience:  'all_admin',
                title:     'Retrait refusé',
                body:      `Retrait #${id} de ${reqData.username} refusé`,
                actorId:   reviewerId,
                subjectId: reqData.uid,
                metadata:  { request_id: parseInt(id), note: note || null }
            }).catch(e => console.error('[withdrawal.reject] notif:', e.message));

            const playerSocketId = connectedSockets?.get(reqData.uid);
            if (playerSocketId) {
                io.to(playerSocketId).emit('withdrawal:rejected', {
                    request_id: parseInt(id),
                    reason: note || 'Demande refusée par l\'administration.'
                });
            }
        }

        res.json({ msg: 'Demande de retrait refusée.' });
    } catch (err) {
        console.error('[withdrawal.reject]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};

// PUT /api/money/withdrawals/:id/pay
exports.markPaid = async (req, res) => {
    if (req.user.role === 'player') {
        return res.status(403).json({ msg: 'Accès refusé.' });
    }
    const { id } = req.params;
    const reviewerId = req.user.id;

    try {
        const { rows } = await db.query(`
            SELECT wr.*, u.username, u.wallet, u.id AS uid
            FROM withdrawal_requests wr
            JOIN users u ON u.id = wr.user_id
            WHERE wr.id=$1
        `, [id]);

        if (!rows[0]) return res.status(404).json({ msg: 'Demande introuvable.' });
        const reqData = rows[0];

        if (reqData.status === 'paid') return res.status(400).json({ msg: 'Ce retrait est déjà marqué payé.' });
        if (reqData.status === 'rejected') return res.status(400).json({ msg: 'Ce retrait a été refusé — impossible de le payer.' });

        const amount       = parseFloat(reqData.amount);
        const walletBefore = parseFloat(reqData.wallet);

        if (walletBefore < amount) {
            return res.status(400).json({ msg: 'Solde joueur insuffisant pour effectuer ce retrait.' });
        }

        const walletAfter = walletBefore - amount;

        await db.query('UPDATE users SET wallet = wallet - $1 WHERE id = $2', [amount, reqData.uid]);
        await db.query(
            `INSERT INTO transactions (user_id, amount, balance_before, balance_after, type, note)
             VALUES ($1, $2, $3, $4, 'transfert', $5)`,
            [reqData.uid, -amount, walletBefore, walletAfter,
             `Retrait Wave #${id} — ${reqData.wave_number}`]
        );
        await db.query(
            "UPDATE withdrawal_requests SET status='paid', reviewed_by=$1, reviewed_at=NOW(), paid_at=NOW() WHERE id=$2",
            [reviewerId, id]
        );
        await db.query(
            `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_value)
             VALUES ($1, 'withdrawal_paid', 'withdrawal_requests', $2, $3::jsonb)`,
            [reviewerId, parseInt(id), JSON.stringify({
                amount, wave_number: reqData.wave_number,
                balance_before: walletBefore, balance_after: walletAfter
            })]
        );

        const io = req.app.get('io');
        const connectedSockets = req.app.get('connectedSockets');
        if (io) {
            notifService.createAndBroadcast(db, io, {
                type:      'retrait_paye',
                audience:  'all_admin',
                title:     'Retrait payé',
                body:      `${amount.toLocaleString('fr-FR')} FCFA versés à ${reqData.username} via Wave ${reqData.wave_number}`,
                actorId:   reviewerId,
                subjectId: reqData.uid,
                metadata:  { request_id: parseInt(id), amount, wave_number: reqData.wave_number }
            }).catch(e => console.error('[withdrawal.markPaid] notif:', e.message));

            const playerSocketId = connectedSockets?.get(reqData.uid);
            if (playerSocketId) {
                io.to(playerSocketId).emit('withdrawal:paid', {
                    request_id: parseInt(id),
                    amount,
                    new_balance: walletAfter
                });
                io.to(playerSocketId).emit('wallet-update', { balance: walletAfter });
            }
        }

        res.json({ msg: 'Retrait marqué comme payé. Solde joueur débité.', new_balance: walletAfter });
    } catch (err) {
        console.error('[withdrawal.markPaid]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};
