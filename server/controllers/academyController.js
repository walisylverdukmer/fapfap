const db = require('../config/db');

const DAILY_GRANT_AMOUNT = 10000;
const DAILY_GRANT_MS     = 24 * 60 * 60 * 1000;

// GET /api/academy/wallet
exports.getWallet = async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT balance, last_daily_grant, total_granted,
                    games_played, games_won, games_lost,
                    total_won, total_lost, current_streak, best_streak
             FROM academy_wallets
             WHERE user_id = $1`,
            [req.user.id]
        );

        if (!rows.length) {
            return res.status(404).json({ msg: 'Wallet académie introuvable.' });
        }

        const w          = rows[0];
        const now        = Date.now();
        const lastGrant  = w.last_daily_grant ? new Date(w.last_daily_grant).getTime() : 0;
        const canClaim   = (now - lastGrant) >= DAILY_GRANT_MS;
        const nextGrant  = canClaim ? null : new Date(lastGrant + DAILY_GRANT_MS).toISOString();

        res.json({
            balance:         parseFloat(w.balance),
            total_granted:   parseFloat(w.total_granted),
            last_daily_grant: w.last_daily_grant,
            can_claim:       canClaim,
            next_grant:      nextGrant,
            stats: {
                games_played:  w.games_played,
                games_won:     w.games_won,
                games_lost:    w.games_lost,
                total_won:     parseFloat(w.total_won),
                total_lost:    parseFloat(w.total_lost),
                current_streak: w.current_streak,
                best_streak:   w.best_streak,
                win_rate: w.games_played > 0
                    ? Math.round(w.games_won / w.games_played * 100 * 10) / 10
                    : 0
            }
        });
    } catch (err) {
        console.error('[academy.getWallet]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};

// POST /api/academy/daily-grant
exports.claimDaily = async (req, res) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            'SELECT balance, last_daily_grant FROM academy_wallets WHERE user_id=$1 FOR UPDATE',
            [req.user.id]
        );

        if (!rows.length) {
            await client.query('ROLLBACK');
            client.release();
            return res.status(404).json({ msg: 'Wallet académie introuvable.' });
        }

        const w        = rows[0];
        const now      = Date.now();
        const lastGrant = w.last_daily_grant ? new Date(w.last_daily_grant).getTime() : 0;

        if ((now - lastGrant) < DAILY_GRANT_MS) {
            await client.query('ROLLBACK');
            client.release();
            const next = new Date(lastGrant + DAILY_GRANT_MS).toISOString();
            return res.status(429).json({
                msg:        'Vous avez déjà récupéré vos jetons aujourd\'hui.',
                next_grant: next
            });
        }

        const balanceBefore = parseFloat(w.balance);
        const balanceAfter  = balanceBefore + DAILY_GRANT_AMOUNT;
        const today         = new Date().toISOString().slice(0, 10);

        await client.query(
            `UPDATE academy_wallets
             SET balance = $1, last_daily_grant = NOW(), total_granted = total_granted + $2
             WHERE user_id = $3`,
            [balanceAfter, DAILY_GRANT_AMOUNT, req.user.id]
        );

        await client.query(
            `INSERT INTO academy_transactions
                (user_id, transaction_type, amount, balance_before, balance_after, reference)
             VALUES ($1, 'DAILY_GRANT', $2, $3, $4, $5)`,
            [req.user.id, DAILY_GRANT_AMOUNT, balanceBefore, balanceAfter, `Crédit quotidien du ${today}`]
        );

        await client.query('COMMIT');
        client.release();

        // Notifier le socket si le joueur est connecté
        const io             = req.app.get('io');
        const connectedSockets = req.app.get('connectedSockets');
        const sockId         = connectedSockets?.get(req.user.id);
        if (io && sockId) {
            io.to(sockId).emit('academy:daily-claimed', {
                granted:     DAILY_GRANT_AMOUNT,
                new_balance: balanceAfter
            });
        }

        res.json({
            granted:     DAILY_GRANT_AMOUNT,
            new_balance: balanceAfter,
            msg:         `+${DAILY_GRANT_AMOUNT.toLocaleString('fr-FR')} JETONS ajoutés !`
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
        console.error('[academy.claimDaily]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};

// GET /api/academy/history?limit=50&offset=0
exports.getHistory = async (req, res) => {
    const limit  = Math.min(parseInt(req.query.limit  || '50', 10), 100);
    const offset = Math.max(parseInt(req.query.offset || '0',  10), 0);

    try {
        const { rows } = await db.query(
            `SELECT id, transaction_type, amount, balance_before, balance_after,
                    reference, game_session_id, created_at
             FROM academy_transactions
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
            [req.user.id, limit, offset]
        );

        res.json({ transactions: rows, limit, offset });
    } catch (err) {
        console.error('[academy.getHistory]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};

// GET /api/academy/leaderboard/:period  (week | month | alltime)
exports.getLeaderboard = async (req, res) => {
    const { period } = req.params;

    const VIEWS = {
        week:    'v_academy_leaderboard_week',
        month:   'v_academy_leaderboard_month',
        alltime: 'v_academy_leaderboard_alltime'
    };

    const view = VIEWS[period];
    if (!view) {
        return res.status(400).json({ msg: 'Période invalide. Valeurs acceptées : week, month, alltime.' });
    }

    try {
        const { rows } = await db.query(`SELECT * FROM ${view} LIMIT 20`);
        res.json({ period, leaderboard: rows });
    } catch (err) {
        console.error('[academy.getLeaderboard]', err.message);
        res.status(500).json({ msg: 'Erreur serveur.' });
    }
};
