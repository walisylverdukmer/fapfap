const db = require('../config/db');

// --- RÉCUPÉRATION DES DONNÉES ---

exports.getBalance = async (req, res) => {
    try {
        const { rows } = await db.query(
            "SELECT wallet FROM users WHERE id = $1",
            [req.user.id]
        );
        if (rows.length === 0) return res.status(404).json({ msg: "Utilisateur non trouvé" });
        res.json({ wallet: parseFloat(rows[0].wallet) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getAllKatikas = async (req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT u.id, u.username, u.phone, u.wallet, c.name AS club_name
            FROM users u
            LEFT JOIN clubs c ON u.id = c.katika_id
            WHERE u.role = 'katika'
            ORDER BY u.username ASC
        `);
        // Normaliser wallet en nombre
        res.json(rows.map(r => ({ ...r, wallet: parseFloat(r.wallet) })));
    } catch (error) {
        console.error("Erreur getAllKatikas:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.getClubPlayers = async (req, res) => {
    try {
        const { club_id } = req.params;

        if (!club_id || club_id === 'undefined' || club_id === 'null') {
            console.warn("Tentative de récupération de joueurs sans ID de club valide.");
            return res.json([]);
        }

        const { rows } = await db.query(
            "SELECT id, username, phone, wallet, role FROM users WHERE club_id = $1 AND role = 'player' ORDER BY username ASC",
            [club_id]
        );

        res.json(rows.map(r => ({ ...r, wallet: parseFloat(r.wallet) })));
    } catch (error) {
        console.error("Erreur getClubPlayers:", error);
        res.status(500).json({ error: "Erreur lors de la récupération des joueurs." });
    }
};

// --- MOUVEMENTS D'ARGENT ---

exports.transferFunds = async (req, res) => {
    const { receiver_id, amount } = req.body;
    const sender_id = req.user.id;
    const sender_role = req.user.role;

    if (!receiver_id || !amount || amount <= 0) {
        return res.status(400).json({ msg: "Données de transfert invalides (ID ou montant)." });
    }

    try {
        // 1. Vérification et débit de l'expéditeur (Katika seulement — Wali a solde illimité)
        if (sender_role !== 'superadmin') {
            const { rows: senderRows } = await db.query(
                "SELECT wallet FROM users WHERE id = $1",
                [sender_id]
            );
            if (!senderRows[0] || parseFloat(senderRows[0].wallet) < parseFloat(amount)) {
                return res.status(400).json({ msg: "Solde insuffisant pour effectuer ce dépôt." });
            }
            await db.query(
                "UPDATE users SET wallet = wallet - $1 WHERE id = $2",
                [amount, sender_id]
            );
        }

        // 2. Lire le solde du destinataire avant crédit
        const { rows: receiverBefore } = await db.query(
            "SELECT wallet FROM users WHERE id = $1",
            [receiver_id]
        );
        if (receiverBefore.length === 0) {
            return res.status(404).json({ msg: "Destinataire introuvable." });
        }
        const balanceBefore = parseFloat(receiverBefore[0].wallet);
        const balanceAfter  = balanceBefore + parseFloat(amount);

        // 3. Créditer le destinataire
        const updateResult = await db.query(
            "UPDATE users SET wallet = wallet + $1 WHERE id = $2",
            [amount, receiver_id]
        );
        if (updateResult.rowCount === 0) {
            return res.status(404).json({ msg: "Destinataire introuvable." });
        }

        // 4. Enregistrer dans l'historique
        await db.query(
            `INSERT INTO transactions (user_id, sender_id, amount, balance_before, balance_after, type)
             VALUES ($1, $2, $3, $4, $5, 'transfert')`,
            [receiver_id, sender_id, amount, balanceBefore, balanceAfter]
        );

        res.json({ msg: "Transaction effectuée avec succès !" });
    } catch (error) {
        console.error("Erreur transfert:", error);
        res.status(500).json({ error: "Erreur technique lors de la transaction." });
    }
};

