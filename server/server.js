require('dotenv').config();

// Vérification critique au démarrage
if (!process.env.JWT_SECRET) {
    console.error('[FATAL] JWT_SECRET absent du .env — arrêt immédiat.');
    process.exit(1);
}

const express    = require('express');
const http       = require('http');
const path       = require('path');
const { Server } = require('socket.io');
const cors       = require('cors');
const jwt        = require('jsonwebtoken');
const db         = require('./config/db');

const moneyRoutes         = require('./routes/moneyRoutes');
const authRoutes          = require('./routes/authRoutes');
const adminRoutes         = require('./routes/adminRoutes');
const salonRoutes         = require('./routes/salonRoutes');
const notificationRoutes    = require('./routes/notificationRoutes');
const academyRoutes         = require('./routes/academyRoutes');
const announcementRoutes    = require('./routes/announcementRoutes');
const termsRoutes           = require('./routes/termsRoutes');

// Sprint 5 — CORS whitelist (remplace origin: "*")
// Render injecte RENDER_EXTERNAL_URL automatiquement → auto-ajouté à la whitelist
const ALLOWED_ORIGINS = [
    ...(process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
        : ['http://localhost:5000', 'http://127.0.0.1:5000']),
    ...(process.env.RENDER_EXTERNAL_URL ? [process.env.RENDER_EXTERNAL_URL] : [])
];

const corsOriginFn = (origin, callback) => {
    // Autorise les requêtes sans origine (file://, curl, Postman en dev)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS bloqué : origine non autorisée (${origin})`));
};

const app = express();
app.use(cors({
    origin: corsOriginFn,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

app.use('/api/money',         moneyRoutes);
app.use('/api/auth',          authRoutes);
app.use('/api/admin',         adminRoutes);
app.use('/api/salon',         salonRoutes);
app.use('/api/notifications',  notificationRoutes);
app.use('/api/academy',        academyRoutes);
app.use('/api/announcements',  announcementRoutes);
app.use('/api/terms',          termsRoutes);

// Empêche la mise en cache des pages HTML protégées (fix retour arrière après logout)
app.use((req, res, next) => {
    if (req.path.endsWith('.html') || req.path === '/') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});

// Fichiers statiques client (dev local + Render production)
app.use(express.static(path.join(__dirname, '..', 'client')));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: corsOriginFn, methods: ['GET', 'POST'] }
});

// État global
let tables = {};
const connectedSockets = new Map(); // userId → socketId
const TURN_TIMEOUT_MS  = parseInt(process.env.TURN_TIMEOUT_MS || '30000', 10);

app.set('io', io);
app.set('connectedSockets', connectedSockets);

// Debounce broadcastSalonState — évite les rafales de requêtes SQL sur événements simultanés
let _salonBroadcastTimer = null;
function scheduleBroadcastSalonState() {
    if (_salonBroadcastTimer) return;
    _salonBroadcastTimer = setTimeout(() => {
        _salonBroadcastTimer = null;
        broadcastSalonState();
    }, 400);
}

// ============================================================
// FONCTIONS UTILITAIRES (hors connexion — accèdent à io/tables/db)
// ============================================================

// Salon 2.0 : résout le tableId RAM depuis les données du client
// Priorité : salon_table_id (2.0) > club_id (legacy)
function resolveTableId(data) {
    if (data && data.salon_table_id) return `salon_${data.salon_table_id}`;
    return `club_${data && data.club_id}`;
}

function logAction(tableId, message, type = 'info') {
    io.to(tableId).emit('history-update', {
        message,
        type,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
}

// BUG-01 : Validation serveur des victoires spéciales
function validateSpecialVictory(hand, type) {
    if (!hand || hand.length !== 5) return false;
    const values = hand.map(c => c.value);
    const suits  = hand.map(c => c.suit);
    switch (type) {
        case 'TCHIA':
            return values.reduce((a, b) => a + b, 0) <= 21;
        case '3 SEPT':
            return values.filter(v => v === 7).length >= 3;
        case 'CARRE': {
            const counts = {};
            values.forEach(v => counts[v] = (counts[v] || 0) + 1);
            return Object.values(counts).some(c => c >= 4);
        }
        case 'COULEUR':
            return suits.every(s => s === suits[0]) && !values.includes(3);
        case 'KORATTE':
            return suits.every(s => s === suits[0]) && values.includes(3);
        default:
            return false;
    }
}

// BUG-15 : Suspension automatique après 3 claims frauduleux
async function autoSuspendCheater(player, tableId, socket) {
    if (!player.dbId) return;
    try {
        const { rows } = await db.query('SELECT status FROM users WHERE id=$1', [player.dbId]);
        const oldStatus = rows[0]?.status || 'active';
        if (oldStatus !== 'active') return; // Déjà suspendu

        await db.query("UPDATE users SET status='suspended' WHERE id=$1", [player.dbId]);
        await db.query(
            `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_value, new_value)
             VALUES ($1, 'auto_suspend_cheat', 'users', $1, $2::jsonb, $3::jsonb)`,
            [player.dbId,
             JSON.stringify({ status: oldStatus }),
             JSON.stringify({ status: 'suspended', reason: '3 tentatives de victoire frauduleuse' })]
        );

        io.to(tableId).emit('player-cheating-banned', {
            username: player.username,
            reason:   'Exclusion automatique : 3 tentatives de fraude.'
        });
        socket.emit('force-disconnect', {
            reason: 'Compte suspendu automatiquement pour fraude répétée.'
        });
        socket.disconnect(true);
        console.warn(`[SÉCURITÉ] ${player.username} suspendu pour fraude répétée.`);
    } catch (err) {
        console.error('[autoSuspendCheater]', err.message);
    }
}

// Sprint 5 — Timer de tour
function clearTurnTimer(tableId) {
    const table = tables[tableId];
    if (!table) return;
    if (table.turnTimer)        { clearTimeout(table.turnTimer);          table.turnTimer = null; }
    if (table.turnTickInterval) { clearInterval(table.turnTickInterval);  table.turnTickInterval = null; }
}

function startTurnTimer(tableId) {
    const table = tables[tableId];
    if (!table) return;
    clearTurnTimer(tableId);

    const expectedId = table.players[table.turnIndex]?.id;
    if (!expectedId) return;

    // Tick chaque seconde — countdown visible côté client
    let secondsLeft = Math.floor(TURN_TIMEOUT_MS / 1000);
    table.turnTickInterval = setInterval(() => {
        secondsLeft--;
        io.to(tableId).emit('turn-tick', { secondsLeft, playerId: expectedId });
        if (secondsLeft <= 0) {
            clearInterval(table.turnTickInterval);
            table.turnTickInterval = null;
        }
    }, 1000);

    table.turnTimer = setTimeout(() => {
        const t = tables[tableId];
        if (!t || t.status !== 'PLAYING') return;
        const current = t.players[t.turnIndex];
        if (!current || current.id !== expectedId || !current.isInHand) return;

        clearTurnTimer(tableId);
        current.isInHand = false;
        current.hand     = [];
        logAction(tableId, `${current.username} a dépassé le temps (${TURN_TIMEOUT_MS / 1000}s) — auto-banqué.`, 'warning');
        io.to(tableId).emit('player-folded', { username: current.username, id: current.id, autoFold: true });

        const active = t.players.filter(p => p.isInHand);
        if (active.length === 1) {
            routeGameOver(tableId, active[0], t.pot, 'TOUS BANQUÉ (timeout)', t.clubId, 'tous_banque');
        } else if (active.length > 1) {
            passTurn(tableId);
        }
    }, TURN_TIMEOUT_MS);
}

function passTurn(tableId) {
    const table = tables[tableId];
    if (!table) return;
    const activePlaying = table.players.filter(p => p.isInHand && !p.isPassing && p.hand.length > 0);

    if (activePlaying.length === 0) {
        checkFinalReveal(tableId, null, null, false, table.clubId);
        return;
    }

    let nextIdx = (table.turnIndex - 1 + table.players.length) % table.players.length;
    let guard   = table.players.length;
    while (guard-- > 0 && (
        !table.players[nextIdx].isInHand ||
         table.players[nextIdx].isPassing ||
         table.players[nextIdx].hand.length === 0
    )) {
        nextIdx = (nextIdx - 1 + table.players.length) % table.players.length;
    }
    table.turnIndex = nextIdx;

    io.to(tableId).emit('next-turn', {
        activePlayerId: table.players[table.turnIndex].id,
        activeUsername: table.players[table.turnIndex].username
    });
    startTurnTimer(tableId);
}

function determineTrickWinner(tableId, table, club_id) {
    if (table.cardsOnTable.length === 0) return;
    const leadingCard = table.cardsOnTable[0].card;
    let winnerEntry   = table.cardsOnTable[0];
    for (let i = 1; i < table.cardsOnTable.length; i++) {
        const challenger = table.cardsOnTable[i];
        if (challenger.card.suit === leadingCard.suit && challenger.card.value > winnerEntry.card.value) {
            winnerEntry = challenger;
        }
    }
    table.turnIndex        = table.players.findIndex(p => p.id === winnerEntry.playerId);
    const winnerObj        = table.players[table.turnIndex];

    setTimeout(() => {
        if (!tables[tableId] || tables[tableId].status !== 'PLAYING') return;
        const playersWithCards = tables[tableId].players.filter(
            p => p.isInHand && !p.isPassing && p.hand.length > 0
        );
        if (playersWithCards.length === 0) {
            checkFinalReveal(tableId, winnerObj, winnerEntry.card, (winnerEntry.card.value === 3), club_id);
        } else {
            // BUG-02 + BUG-03 corrigés
            table.cardsOnTable       = [];
            table.cardsPlayedInRound = 0;
            io.to(tableId).emit('clear-table', { winnerId: winnerObj.id });
            io.to(tableId).emit('next-turn', {
                activePlayerId: winnerObj.id,
                activeUsername: winnerObj.username
            });
            startTurnTimer(tableId);
        }
    }, 800);
}

// BUG-04 corrigé : comparaison inter-passeurs
function checkFinalReveal(tableId, lastWinnerObj, lastCard, isFinalKoratte = false, club_id) {
    const table = tables[tableId];
    if (!table) return;
    clearTurnTimer(tableId);

    const passers       = table.players.filter(p => p.isPassing);
    const passerEntries = passers.map(p => {
        const best = [...p.passedCards].sort((a, b) => b.value - a.value)[0];
        io.to(tableId).emit('display-card', { playerId: p.id, username: p.username, card: best });
        return { player: p, card: best };
    });

    let finalWinner  = lastWinnerObj;
    let finalCardVal = lastCard;

    if (!finalWinner && passerEntries.length > 0) {
        // Tous ont passé : meilleure valeur toutes couleurs confondues
        const best = passerEntries.reduce((acc, cur) =>
            cur.card.value > acc.card.value ? cur : acc
        );
        finalWinner  = best.player;
        finalCardVal = best.card;
    } else if (finalWinner && passerEntries.length > 0) {
        // Un pli a été joué : même couleur que la dernière carte gagnante et valeur supérieure
        for (const { player, card } of passerEntries) {
            if (finalCardVal && card.suit === finalCardVal.suit && card.value > finalCardVal.value) {
                finalWinner  = player;
                finalCardVal = card;
            }
        }
    }

    const currentPot = isFinalKoratte ? table.pot * 2 : table.pot;
    const reason     = isFinalKoratte ? 'KORATTE (3 final)' : 'FIN DE MANCHE';
    const winType    = isFinalKoratte ? 'koratte' : 'normal';

    setTimeout(() => {
        routeGameOver(tableId, finalWinner, currentPot, reason, club_id, winType);
    }, 2500);
}

// Barème FAP FAP 2.2 : commission variable selon le nombre de joueurs
function commissionRateByPlayerCount(nbPlayers) {
    if (nbPlayers <= 2) return 0.03; // 3 %
    if (nbPlayers === 3) return 0.05; // 5 %
    return 0.07; // 7 % pour 4+ joueurs
}

// Sprint 2 : commission + audit_logs + game_sessions
async function handleGameOver(tableId, winner, pot, reason, club_id, winType = 'normal') {
    const table = tables[tableId];
    if (!table || !winner) return;
    clearTurnTimer(tableId);

    let winnerGain     = parseFloat(pot);
    let commission     = 0;
    let katikaId       = null;
    let waliId         = null;

    // Commission dynamique selon le nombre de joueurs à la table
    const nbPlayers    = table.players.length || 2;
    const commissionRate = commissionRateByPlayerCount(nbPlayers);

    try {
        const { rows: clubRows } = await db.query(
            'SELECT katika_id FROM clubs WHERE id=$1', [club_id]
        );
        if (clubRows[0]) {
            katikaId = clubRows[0].katika_id;
        }
        commission = Math.round(parseFloat(pot) * commissionRate * 100) / 100;
        winnerGain = parseFloat(pot) - commission;

        const { rows: balRows } = await db.query(
            'SELECT id, wallet FROM users WHERE username=$1', [winner.username]
        );
        const winnerDbId    = balRows[0]?.id || winner.dbId;
        const balanceBefore = balRows.length > 0 ? parseFloat(balRows[0].wallet) : 0;
        const balanceAfter  = balanceBefore + winnerGain;

        await db.query('UPDATE users SET wallet=wallet+$1 WHERE username=$2', [winnerGain, winner.username]);
        await db.query(
            `INSERT INTO transactions (user_id, club_id, amount, balance_before, balance_after, type)
             VALUES ($1, $2, $3, $4, $5, 'gain')`,
            [winnerDbId, club_id, winnerGain, balanceBefore, balanceAfter]
        );

        if (commission > 0) {
            const { rows: waliRows } = await db.query(
                "SELECT id, wallet FROM users WHERE role='superadmin' LIMIT 1"
            );
            if (waliRows.length > 0) {
                const wali    = waliRows[0];
                waliId        = wali.id;
                const waliBefore = parseFloat(wali.wallet);
                await db.query('UPDATE users SET wallet=wallet+$1 WHERE id=$2', [commission, waliId]);
                await db.query(
                    `INSERT INTO transactions (user_id, club_id, amount, balance_before, balance_after, type, note)
                     VALUES ($1, $2, $3, $4, $5, 'commission', $6)`,
                    [waliId, club_id, commission, waliBefore, waliBefore + commission,
                     `Commission ${(commissionRate * 100).toFixed(0)}% (${nbPlayers}j) — club ${club_id}`]
                );
            }
        }

        if (table.gameSessionId) {
            await db.query(
                `UPDATE game_sessions
                 SET winner_id=$1, commission=$2, pot_total=$3, win_type=$4::win_type,
                     status='finished', finished_at=NOW()
                 WHERE id=$5`,
                [winnerDbId, commission, parseFloat(pot), winType, table.gameSessionId]
            );
            if (commission > 0 && waliId && katikaId) {
                await db.query(
                    `INSERT INTO commissions
                     (game_session_id, club_id, wali_id, katika_id, pot_total, rate, amount, status, paid_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, 'paid', NOW())`,
                    [table.gameSessionId, club_id, waliId, katikaId,
                     parseFloat(pot), commissionRate, commission]
                );
            }
            await db.query(
                `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_value)
                 VALUES ($1, 'game_finished', 'game_sessions', $2, $3::jsonb)`,
                [winnerDbId, table.gameSessionId, JSON.stringify({
                    winner: winner.username, win_type: winType,
                    pot: parseFloat(pot), commission, winner_gain: winnerGain
                })]
            );
        }

        winner.wallet = balanceAfter;
        io.to(winner.id).emit('wallet-update', { balance: winner.wallet });
        io.to(tableId).emit('player-list-update', table.players);
    } catch (err) {
        console.error('[handleGameOver] Erreur crédit:', err);
    }

    table.status        = 'WAITING';
    table.gameSessionId = null;
    table.dealerIndex   = table.players.findIndex(p => p.id === winner.id);

    const logMsg = commission > 0
        ? `VICTOIRE de ${winner.username} — gain: ${winnerGain} FCFA | commission Wali: ${commission} FCFA.`
        : `VICTOIRE de ${winner.username} (${pot} FCFA).`;
    logAction(tableId, logMsg, 'victory');

    io.to(tableId).emit('game-over', {
        winnerId:       winner.id,
        winnerUsername: winner.username,
        winnerAvatar:   winner.avatar,
        potAmount:      winnerGain,
        commission,
        reason,
        newDealerId:    winner.id
    });
    io.to(tableId).emit('update-dealer', { dealerId: winner.id });
}

// Académie — JETONS : crédite le gagnant, met à jour les stats, aucune commission
async function handleAcademyGameOver(tableId, winner, pot, reason, winType = 'normal') {
    const table = tables[tableId];
    if (!table || !winner) return;
    clearTurnTimer(tableId);

    const winnerGain = parseFloat(pot);

    try {
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            // 1. Créditer le gagnant + stats victoire
            const { rows: wb } = await client.query(
                'SELECT balance FROM academy_wallets WHERE user_id=$1 FOR UPDATE',
                [winner.dbId]
            );
            const winBalBefore = parseFloat(wb[0]?.balance || 0);
            const winBalAfter  = winBalBefore + winnerGain;

            await client.query(
                `UPDATE academy_wallets
                 SET balance        = $1,
                     games_played   = games_played + 1,
                     games_won      = games_won    + 1,
                     total_won      = total_won    + $2,
                     current_streak = current_streak + 1,
                     best_streak    = GREATEST(best_streak, current_streak + 1)
                 WHERE user_id = $3`,
                [winBalAfter, winnerGain, winner.dbId]
            );
            await client.query(
                `INSERT INTO academy_transactions
                 (user_id, transaction_type, amount, balance_before, balance_after, reference, game_session_id)
                 VALUES ($1, 'VICTORY', $2, $3, $4, $5, $6)`,
                [winner.dbId, winnerGain, winBalBefore, winBalAfter,
                 `Victoire — ${reason}`, table.gameSessionId]
            );

            // 2. Stats défaite pour chaque perdant
            for (const p of table.players) {
                if (!p.dbId || p.dbId === winner.dbId) continue;
                const { rows: lb } = await client.query(
                    'SELECT balance FROM academy_wallets WHERE user_id=$1 FOR UPDATE', [p.dbId]
                );
                const lBal = parseFloat(lb[0]?.balance || 0);

                await client.query(
                    `UPDATE academy_wallets
                     SET games_played   = games_played + 1,
                         games_lost     = games_lost   + 1,
                         current_streak = 0
                     WHERE user_id = $1`,
                    [p.dbId]
                );
                await client.query(
                    `INSERT INTO academy_transactions
                     (user_id, transaction_type, amount, balance_before, balance_after, reference, game_session_id)
                     VALUES ($1, 'DEFEAT', $2, $3, $4, $5, $6)`,
                    [p.dbId, -table.stake, lBal + table.stake, lBal,
                     `Défaite — ${reason}`, table.gameSessionId]
                );
            }

            await client.query('COMMIT');

            winner.wallet = winBalAfter;
            io.to(winner.id).emit('wallet-update', { balance: winBalAfter });
            io.to(tableId).emit('player-list-update', table.players);

        } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('[handleAcademyGameOver]', err.message);
    }

    table.status        = 'WAITING';
    table.gameSessionId = null;
    table.dealerIndex   = table.players.findIndex(p => p.id === winner.id);

    logAction(tableId, `VICTOIRE de ${winner.username} — gain: ${winnerGain} JETONS.`, 'victory');

    io.to(tableId).emit('game-over', {
        winnerId:       winner.id,
        winnerUsername: winner.username,
        winnerAvatar:   winner.avatar,
        potAmount:      winnerGain,
        commission:     0,
        reason,
        newDealerId:    winner.id
    });
    io.to(tableId).emit('update-dealer', { dealerId: winner.id });
}

// Routeur unique — délègue vers academy ou real selon le type de table
function routeGameOver(tableId, winner, pot, reason, clubId, winType = 'normal') {
    if (tables[tableId]?.tableType === 'academy') {
        handleAcademyGameOver(tableId, winner, pot, reason, winType);
    } else {
        handleGameOver(tableId, winner, pot, reason, clubId, winType);
    }
}

// Sprint 5 — Gestion des déconnexions en cours de partie
function handleDeparture(socket, tableId) {
    const table = tables[tableId];
    if (!table) return;
    const pIdx = table.players.findIndex(p => p.id === socket.id);
    if (pIdx === -1) return;

    const player    = table.players[pIdx];
    const wasInTurn = (table.turnIndex === pIdx);
    const wasDealer = (table.dealerIndex === pIdx);

    // Auto-fold si partie en cours et joueur actif
    if (table.status === 'PLAYING' && player.isInHand && !player.isPassing) {
        clearTurnTimer(tableId);
        player.isInHand = false;
        player.hand     = [];
        logAction(tableId, `${player.username} s'est déconnecté — auto-banqué.`, 'warning');
        io.to(tableId).emit('player-folded', { username: player.username, id: player.id, autoFold: true });
    }

    table.players.splice(pIdx, 1);

    // Salon 2.0 : nettoyer le siège en DB si table salon
    if (tableId.startsWith('salon_') && socket.userId) {
        const salonId = parseInt(tableId.replace('salon_', ''), 10);
        db.query('DELETE FROM table_seats WHERE table_id=$1 AND user_id=$2', [salonId, socket.userId])
            .catch(e => console.error('[handleDeparture] seat cleanup:', e.message));
    }

    if (table.players.length === 0) {
        clearTurnTimer(tableId);
        delete tables[tableId];
        if (tableId.startsWith('salon_')) scheduleBroadcastSalonState();
        return;
    }

    // Ajustement des indices après suppression
    if (table.dealerIndex >= pIdx && table.dealerIndex > 0) table.dealerIndex--;
    if (table.turnIndex  >= pIdx && table.turnIndex  > 0) table.turnIndex--;

    if (wasDealer) {
        table.dealerIndex = pIdx % table.players.length;
        const newDealer   = table.players[table.dealerIndex];
        if (newDealer) io.to(tableId).emit('update-dealer', { dealerId: newDealer.id });
    }

    io.to(tableId).emit('player-list-update', table.players);

    if (table.status === 'PLAYING') {
        const active = table.players.filter(p => p.isInHand);
        if (active.length === 1) {
            routeGameOver(tableId, active[0], table.pot, 'TOUS BANQUÉ (déconnexion)', table.clubId, 'tous_banque');
        } else if (active.length > 1 && wasInTurn) {
            passTurn(tableId);
        }
    }
}

// ============================================================
// SALON 2.0 — Diffusion de l'état du salon à tous les clients
// ============================================================

async function broadcastSalonState() {
    try {
        const { rows } = await db.query('SELECT * FROM v_salon_state');
        // Enrichir avec l'état RAM (statut de partie en cours)
        const state = rows.map(row => {
            const ram = tables[`salon_${row.table_id}`];
            return {
                ...row,
                live_players: ram ? ram.players.length : Number(row.seated_count),
                game_status:  ram ? ram.status : 'WAITING'
            };
        });
        io.to('salon_room').emit('salon-state', state);
    } catch (err) {
        console.error('[broadcastSalonState]', err.message);
    }
}

// ============================================================
// CONNEXION SOCKET.IO
// ============================================================

io.on('connection', (socket) => {
    console.log('📱 Connecté :', socket.id);

    // --- 0. AUTHENTIFICATION POST-CONNEXION ---
    // Permet aux admins/joueurs connectés de s'identifier sans bloquer les visiteurs.
    // Les visiteurs anonymes ignorent cet événement et restent en mode lecture seule.
    socket.on('authenticate', (token) => {
        if (!token) return;
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.data.user = decoded;
            socket.userId    = decoded.id;
            socket.userRole  = decoded.role;
            connectedSockets.set(decoded.id, socket.id);

            if (['superadmin', 'katika'].includes(decoded.role)) {
                socket.join('admin_room');
            }
            if (decoded.role === 'superadmin') {
                socket.join('wali_room');
            }
            if (decoded.role === 'katika' && decoded.club_id) {
                socket.join(`club_room_${decoded.club_id}`);
            }
            socket.emit('authenticated', { role: decoded.role, id: decoded.id });
            // Envoyer les stats en temps réel immédiatement à l'admin qui s'authentifie
            if (['superadmin', 'katika'].includes(decoded.role)) {
                socket.emit('visitor:stats', computeOnlineStats());
            }
        } catch {
            socket.emit('auth-error', { reason: 'Token invalide.' });
        }
    });

    // --- 1. REJOINDRE ---
    socket.on('join-table', async (data) => {
        const tableId = resolveTableId(data);
        socket.join(tableId);

        let userBalance = 0;
        let fraudCount  = 0;

        try {
            const { rows } = await db.query(
                'SELECT id, wallet, role, status FROM users WHERE username=$1',
                [data.username]
            );
            if (rows.length > 0) {
                const u = rows[0];

                // Bloquer les comptes suspendus dès le join
                if (u.status !== 'active') {
                    socket.emit('join-refused', { reason: 'Compte suspendu ou inactif. Contactez votre Katika.' });
                    return;
                }

                userBalance      = parseFloat(u.wallet);
                socket.userId    = u.id;
                socket.userRole  = u.role;
                connectedSockets.set(socket.userId, socket.id);
                socket.emit('wallet-update', { balance: userBalance });

                // Sprint 5 : charger le compteur de fraude persisté (24h glissantes)
                const { rows: fRows } = await db.query(
                    `SELECT COUNT(*)::int AS cnt FROM audit_logs
                     WHERE user_id=$1 AND action='claim_fraud'
                       AND created_at > NOW() - INTERVAL '24 hours'`,
                    [u.id]
                );
                fraudCount = fRows[0]?.cnt || 0;
                if (fraudCount >= 2) {
                    console.warn(`[SÉCURITÉ] ${data.username} rejoint avec ${fraudCount} fraude(s) récentes.`);
                }
            }
        } catch (err) {
            console.error('[join-table]', err);
        }

        if (!tables[tableId]) {
            tables[tableId] = {
                players: [],
                pot: 0,
                stake: data.stake || 500,
                status: 'WAITING',
                turnIndex: 0,
                dealerIndex: 0,
                cardsOnTable: [],
                cardsPlayedInRound: 0,
                clubId: data.club_id,
                gameSessionId: null,
                turnTimer: null,
                turnTickInterval: null
            };
        }

        const table = tables[tableId];

        if (table.players.length < 4 && !table.players.find(p => p.username === data.username)) {
            table.players.push({
                id:               socket.id,
                dbId:             socket.userId || null,
                username:         data.username,
                wallet:           userBalance,
                hand:             [],
                avatar:           `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.username}`,
                isInHand:         true,
                isPassing:        false,
                passedCards:      [],
                suspiciousClaims: fraudCount   // Sprint 5 : persisté
            });
            logAction(tableId, `${data.username} a rejoint la table.`);
        }

        io.to(tableId).emit('player-list-update', table.players);
        const dealer = table.players[table.dealerIndex];
        if (dealer) io.to(tableId).emit('update-dealer', { dealerId: dealer.id });
    });

    socket.on('refresh-wallet', async (data) => {
        const tableId = resolveTableId(data);
        try {
            const { rows } = await db.query('SELECT wallet FROM users WHERE username=$1', [data.username]);
            if (rows.length > 0) {
                const newBalance = parseFloat(rows[0].wallet);
                const table = tables[tableId];
                if (table) {
                    const player = table.players.find(p => p.username === data.username);
                    if (player) {
                        player.wallet = newBalance;
                        io.to(tableId).emit('player-list-update', table.players);
                        socket.emit('wallet-update', { balance: newBalance });
                    }
                }
            }
        } catch (err) {
            console.error('[refresh-wallet]', err);
        }
    });

    socket.on('send-chat', (data) => {
        const tableId = resolveTableId(data);
        io.to(tableId).emit('receive-chat', {
            username: data.username,
            message:  data.message,
            time:     new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
    });

    // --- 2. DÉBUT DE PARTIE ---
    socket.on('start-game', async (data) => {
        const tableId = resolveTableId(data);
        const table   = tables[tableId];
        if (!table || table.players.length < 2) return;
        const dealer = table.players[table.dealerIndex];
        if (socket.id !== dealer.id) return;

        // Phase 1 : Vérifier les fonds
        const isAcademy      = table.tableType === 'academy';
        const playerBalances = {}; // username (real) ou dbId (academy)
        try {
            for (const p of table.players) {
                if (isAcademy) {
                    const { rows: awRows } = await db.query(
                        'SELECT balance FROM academy_wallets WHERE user_id=$1', [p.dbId]
                    );
                    const bal = awRows[0] ? parseFloat(awRows[0].balance) : 0;
                    if (!awRows[0] || bal < table.stake) {
                        logAction(tableId, `Jetons insuffisants pour ${p.username}`, 'warning');
                        socket.emit('game-start-failed', { message: `Jetons insuffisants pour ${p.username}` });
                        return;
                    }
                    playerBalances[p.dbId] = bal;
                } else {
                    const { rows: uRows } = await db.query(
                        'SELECT wallet FROM users WHERE username=$1', [p.username]
                    );
                    const walletVal = uRows[0] ? parseFloat(uRows[0].wallet) : 0;
                    if (!uRows[0] || walletVal < table.stake) {
                        logAction(tableId, `Fonds insuffisants pour ${p.username}`, 'warning');
                        socket.emit('game-start-failed', { message: `Fonds insuffisants pour ${p.username}` });
                        return;
                    }
                    playerBalances[p.username] = walletVal;
                }
            }
        } catch (err) {
            console.error('[start-game] Vérification fonds:', err);
            socket.emit('game-start-failed', { message: 'Erreur technique.' });
            return;
        }

        // Phase 2 : Débiter les mises
        try {
            for (const p of table.players) {
                if (isAcademy) {
                    const balanceBefore = playerBalances[p.dbId];
                    const balanceAfter  = balanceBefore - table.stake;
                    await db.query(
                        'UPDATE academy_wallets SET balance=balance-$1 WHERE user_id=$2',
                        [table.stake, p.dbId]
                    );
                    p.wallet = balanceAfter;
                    io.to(p.id).emit('wallet-update', { balance: p.wallet });
                } else {
                    const balanceBefore = playerBalances[p.username];
                    const balanceAfter  = balanceBefore - table.stake;
                    await db.query('UPDATE users SET wallet=wallet-$1 WHERE username=$2', [table.stake, p.username]);
                    await db.query(
                        `INSERT INTO transactions (user_id, club_id, amount, balance_before, balance_after, type)
                         VALUES ((SELECT id FROM users WHERE username=$1), $2, $3, $4, $5, 'mise')`,
                        [p.username, data.club_id, -table.stake, balanceBefore, balanceAfter]
                    );
                    p.wallet = balanceAfter;
                    io.to(p.id).emit('wallet-update', { balance: p.wallet });
                }
            }
            io.to(tableId).emit('player-list-update', table.players);
        } catch (err) {
            console.error('[start-game] Débit mises:', err);
            socket.emit('game-start-failed', { message: 'Erreur lors du prélèvement.' });
            return;
        }

        // Phase 3 : Créer la session de jeu (tables réelles uniquement — non-bloquant)
        if (!isAcademy && dealer.dbId) {
            try {
                const { rows: gsRows } = await db.query(
                    `INSERT INTO game_sessions (club_id, dealer_id, stake, nb_players, status, started_at)
                     VALUES ($1, $2, $3, $4, 'playing', NOW()) RETURNING id`,
                    [data.club_id, dealer.dbId, table.stake, table.players.length]
                );
                table.gameSessionId = gsRows[0].id;
                console.log(`[SESSION] game_session #${table.gameSessionId} créée — club ${data.club_id}`);
            } catch (err) {
                console.error('[start-game] game_session (non-bloquant):', err.message);
                table.gameSessionId = null;
            }
        }

        table.cardsOnTable       = [];
        table.cardsPlayedInRound = 0;
        table.status             = 'PLAYING';
        table.turnIndex          = (table.dealerIndex - 1 + table.players.length) % table.players.length;

        table.players.forEach(p => {
            p.isInHand    = true;
            p.isPassing   = false;
            p.passedCards = [];
        });

        // Mélange Fisher-Yates
        let deck = [];
        const suits = ['spade', 'heart', 'club', 'diamond'];
        for (const s of suits) for (let v = 3; v <= 10; v++) deck.push({ suit: s, value: v });
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        table.players.forEach(p => {
            p.hand = deck.splice(0, 5);
            io.to(p.id).emit('receive-cards', {
                hand: p.hand,
                turn: table.players[table.turnIndex].id === p.id
            });
        });

        table.pot = table.players.length * table.stake;
        logAction(tableId, `Mises collectées. Pot: ${table.pot} ${table.currency || 'FCFA'}.`, 'system');

        io.to(tableId).emit('game-started', {
            pot:            table.pot,
            activePlayer:   table.players[table.turnIndex].username,
            activePlayerId: table.players[table.turnIndex].id,
            dealerId:       dealer.id
        });

        startTurnTimer(tableId); // Sprint 5 : démarrer le timer du premier tour
    });

    // --- 3. ACTIONS DE JEU ---
    socket.on('fold-hand', (data) => {
        const tableId = resolveTableId(data);
        const table   = tables[tableId];
        // BUG-02 corrigé
        if (!table || table.status !== 'PLAYING' || table.cardsPlayedInRound >= 2) return;

        const player = table.players.find(p => p.id === socket.id);
        if (player && player.isInHand && !player.isPassing) {
            clearTurnTimer(tableId);
            player.isInHand = false;
            player.hand     = [];
            logAction(tableId, `${player.username} a banqué.`, 'warning');
            io.to(tableId).emit('player-folded', { username: player.username, id: player.id });

            const active = table.players.filter(p => p.isInHand);
            if (active.length === 1) {
                routeGameOver(tableId, active[0], table.pot, 'TOUS BANQUÉ', table.clubId, 'tous_banque');
            } else if (table.players[table.turnIndex].id === socket.id) {
                passTurn(tableId); // passTurn relance le timer
            } else {
                startTurnTimer(tableId); // Relancer le timer pour le joueur actif
            }
        }
    });

    socket.on('player-pass', (data) => {
        const tableId = resolveTableId(data);
        const table   = tables[tableId];
        if (!table || table.status !== 'PLAYING') return;
        const player = table.players.find(p => p.id === socket.id);
        if (player && player.hand.length === 2 && table.players[table.turnIndex].id === socket.id) {
            clearTurnTimer(tableId);
            player.isPassing   = true;
            player.passedCards = [...player.hand];
            player.hand        = [];
            logAction(tableId, `${player.username} est à PASS.`, 'info');
            io.to(tableId).emit('player-status-pass', { playerId: player.id, username: player.username });
            passTurn(tableId);
        }
    });

    socket.on('card-played', async (data) => {
        const tableId = resolveTableId(data);
        const table   = tables[tableId];
        if (!table || table.status !== 'PLAYING') return;
        const currentPlayer = table.players[table.turnIndex];
        if (socket.id !== currentPlayer.id) return;

        clearTurnTimer(tableId);

        const SUIT_LABELS = { spade: 'Pique', heart: 'Cœur', club: 'Trèfle', diamond: 'Carreau' };

        // --- Validation 1 : structure minimale de la carte reçue ---
        const card = data?.card;
        if (!card || typeof card.suit !== 'string' || typeof card.value !== 'number') {
            socket.emit('card-rejected', { reason: 'Données de carte invalides.' });
            startTurnTimer(tableId);
            return;
        }

        // --- Validation 2 : la carte doit exister dans la main serveur ---
        const cardInHand = currentPlayer.hand.find(
            c => c.suit === card.suit && c.value === card.value
        );
        if (!cardInHand) {
            console.warn(`[TRICHE] ${currentPlayer.username} joue une carte absente de sa main :`, card);
            socket.emit('card-rejected', { reason: "Carte invalide : elle n'est pas dans votre main." });
            if (currentPlayer.dbId) {
                try {
                    await db.query(
                        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_value)
                         VALUES ($1, 'invalid_card_play', 'game_sessions', $2, $3::jsonb)`,
                        [currentPlayer.dbId, table.gameSessionId,
                         JSON.stringify({ attempted: card, hand: currentPlayer.hand })]
                    );
                } catch (err) {
                    console.error('[audit invalid_card_play]', err.message);
                }
            }
            startTurnTimer(tableId);
            return;
        }

        // --- Validation 3 : obligation de suivre la couleur/groupe ---
        // S'applique dès qu'une carte est déjà posée sur la table (couleur d'entame établie)
        if (table.cardsOnTable.length > 0) {
            const leadingSuit    = table.cardsOnTable[0].card.suit;
            const hasLeadingSuit = currentPlayer.hand.some(c => c.suit === leadingSuit);

            if (hasLeadingSuit && card.suit !== leadingSuit) {
                const suitLabel = SUIT_LABELS[leadingSuit] || leadingSuit;
                console.warn(`[RÈGLE] ${currentPlayer.username} ne suit pas la couleur (${leadingSuit}) alors qu'il la possède.`);
                socket.emit('card-rejected', {
                    reason: `Vous devez suivre la couleur en jeu (${suitLabel}). Jouez une carte de cette couleur.`
                });
                if (currentPlayer.dbId) {
                    try {
                        await db.query(
                            `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_value)
                             VALUES ($1, 'suit_violation', 'game_sessions', $2, $3::jsonb)`,
                            [currentPlayer.dbId, table.gameSessionId,
                             JSON.stringify({
                                 attempted:   card,
                                 leadingSuit,
                                 hand:        currentPlayer.hand
                             })]
                        );
                    } catch (err) {
                        console.error('[audit suit_violation]', err.message);
                    }
                }
                startTurnTimer(tableId);
                return;
            }
        }

        // --- Carte valide : retirer de la main et jouer ---
        currentPlayer.hand = currentPlayer.hand.filter(
            c => !(c.suit === card.suit && c.value === card.value)
        );
        const playEntry = { playerId: socket.id, username: currentPlayer.username, card };
        table.cardsOnTable.push(playEntry);
        table.cardsPlayedInRound++; // BUG-02 corrigé
        io.to(tableId).emit('display-card', playEntry);

        const activeInPli = table.players.filter(p => p.isInHand && !p.isPassing);
        if (table.cardsOnTable.length === activeInPli.length) {
            determineTrickWinner(tableId, table, data.club_id);
        } else {
            passTurn(tableId);
        }
    });

    // BUG-01 + Sprint 5 : validation serveur + persistance fraude en base
    socket.on('claim-special-victory', async (data) => {
        const tableId = resolveTableId(data);
        const table   = tables[tableId];
        const winner  = table?.players.find(p => p.id === socket.id);
        if (!winner || !winner.isInHand) return;

        clearTurnTimer(tableId);

        if (!validateSpecialVictory(winner.hand, data.type)) {
            winner.suspiciousClaims = (winner.suspiciousClaims || 0) + 1;
            const remaining = 3 - winner.suspiciousClaims;
            console.warn(`[SÉCURITÉ] Claim frauduleux #${winner.suspiciousClaims}/3 : ${winner.username} → ${data.type}`);

            // Sprint 5 : persistance de la tentative en base
            if (winner.dbId) {
                try {
                    await db.query(
                        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_value)
                         VALUES ($1, 'claim_fraud', 'game_sessions', $2, $3::jsonb)`,
                        [winner.dbId, table.gameSessionId,
                         JSON.stringify({ claimed: data.type, hand: winner.hand, attempt: winner.suspiciousClaims })]
                    );
                } catch (err) {
                    console.error('[claim_fraud] audit_log:', err.message);
                }
            }

            if (winner.suspiciousClaims >= 3) {
                socket.emit('claim-rejected', {
                    reason: `Victoire "${data.type}" invalide. Exclusion pour fraude répétée.`
                });
                autoSuspendCheater(winner, tableId, socket);
            } else {
                socket.emit('claim-rejected', {
                    reason: `Victoire "${data.type}" invalide. Avertissement ${winner.suspiciousClaims}/3 — ${remaining} restant(s).`
                });
                startTurnTimer(tableId); // Relancer le timer (le joueur n'a pas joué)
            }
            return;
        }

        const finalPot   = data.type === 'KORATTE' ? table.pot * 2 : table.pot;
        const winTypeMap = {
            'KORATTE': 'koratte', 'CARRE':  'carre',
            'TCHIA':   'tchia',   '3 SEPT': 'trois_sept', 'COULEUR': 'couleur'
        };
        routeGameOver(tableId, winner, finalPot, data.reason, table.clubId,
            winTypeMap[data.type] || 'normal');
    });

    socket.on('stand-up', (data) => handleDeparture(socket, resolveTableId(data)));

    // ============================================================
    // SALON 2.0 — Événements dynamiques
    // ============================================================

    // Joueur entre dans le lobby salon — reçoit l'état complet
    socket.on('join-salon', async () => {
        socket.join('salon_room');
        try {
            const { rows } = await db.query('SELECT * FROM v_salon_state');
            const state = rows.map(row => {
                const ram = tables[`salon_${row.table_id}`];
                return {
                    ...row,
                    live_players: ram ? ram.players.length : Number(row.seated_count),
                    game_status:  ram ? ram.status : 'WAITING'
                };
            });
            socket.emit('salon-state', state);
        } catch (err) {
            console.error('[join-salon]', err.message);
        }
    });

    // Joueur résout un lien d'invitation
    socket.on('table-invite', async (data) => {
        if (!data?.token) return;
        try {
            const { rows } = await db.query(
                `SELECT id, name, min_bet, max_players, status
                 FROM salon_tables WHERE invite_token=$1 AND status!='closed'`,
                [data.token]
            );
            if (!rows.length) {
                socket.emit('join-refused', { reason: 'Lien d\'invitation invalide ou expiré.' });
                return;
            }
            socket.emit('invite-resolved', rows[0]);
        } catch (err) {
            console.error('[table-invite]', err.message);
        }
    });

    // Joueur s'assoit à une table salon
    socket.on('sit-at-table', async (data) => {
        if (!data?.salon_table_id || !data?.username) return;
        const salonId = parseInt(data.salon_table_id, 10);
        const tableId = `salon_${salonId}`;

        try {
            // Vérifier que la table est ouverte
            const { rows: tRows } = await db.query(
                `SELECT * FROM salon_tables WHERE id=$1 AND status='open'`,
                [salonId]
            );
            if (!tRows.length) {
                socket.emit('join-refused', { reason: 'Table indisponible ou partie en cours.' });
                return;
            }
            const salonTable = tRows[0];

            // Charger l'utilisateur (même logique que join-table)
            const { rows: uRows } = await db.query(
                'SELECT id, wallet, role, status FROM users WHERE username=$1',
                [data.username]
            );
            if (!uRows.length) {
                socket.emit('join-refused', { reason: 'Utilisateur introuvable.' });
                return;
            }
            const u = uRows[0];
            if (u.status !== 'active') {
                socket.emit('join-refused', { reason: 'Compte suspendu. Contactez votre Katika.' });
                return;
            }

            const tableType = salonTable.table_type || 'real';
            const currency  = salonTable.currency  || (tableType === 'academy' ? 'JETONS' : 'FCFA');

            let userBalance;
            if (tableType === 'academy') {
                const { rows: awRows } = await db.query(
                    'SELECT balance FROM academy_wallets WHERE user_id=$1', [u.id]
                );
                userBalance = awRows[0] ? parseFloat(awRows[0].balance) : 0;
            } else {
                userBalance = parseFloat(u.wallet);
            }

            socket.userId   = u.id;
            socket.userRole = u.role;
            connectedSockets.set(u.id, socket.id);

            // Vérifier solde minimum
            if (userBalance < parseFloat(salonTable.min_bet)) {
                socket.emit('join-refused', {
                    reason: `Solde insuffisant. Minimum requis : ${salonTable.min_bet} ${currency}.`
                });
                return;
            }

            // Vérifier places disponibles
            const { rows: seatRows } = await db.query(
                'SELECT seat_number FROM table_seats WHERE table_id=$1 ORDER BY seat_number',
                [salonId]
            );
            if (seatRows.length >= salonTable.max_players) {
                socket.emit('join-refused', { reason: 'Table complète.' });
                return;
            }

            // Trouver le premier siège libre
            const occupied = seatRows.map(r => r.seat_number);
            let seatNum = 1;
            while (occupied.includes(seatNum)) seatNum++;

            // Insérer en DB (ON CONFLICT DO NOTHING si déjà assis)
            await db.query(
                `INSERT INTO table_seats (table_id, user_id, seat_number)
                 VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
                [salonId, u.id, seatNum]
            );

            // Charger compteur de fraude (même logique que join-table)
            const { rows: fRows } = await db.query(
                `SELECT COUNT(*)::int AS cnt FROM audit_logs
                 WHERE user_id=$1 AND action='claim_fraud'
                   AND created_at > NOW() - INTERVAL '24 hours'`,
                [u.id]
            );
            const fraudCount = fRows[0]?.cnt || 0;

            // Initialiser l'état RAM si première arrivée
            if (!tables[tableId]) {
                tables[tableId] = {
                    players: [], pot: 0, stake: parseFloat(salonTable.min_bet),
                    status: 'WAITING', turnIndex: 0, dealerIndex: 0,
                    cardsOnTable: [], cardsPlayedInRound: 0,
                    clubId: salonTable.club_id, salonTableId: salonId,
                    tableType: tableType, currency: currency,
                    gameSessionId: null, turnTimer: null, turnTickInterval: null
                };
            }

            const table = tables[tableId];
            if (!table.players.find(p => p.username === data.username)) {
                table.players.push({
                    id:               socket.id,
                    dbId:             u.id,
                    username:         data.username,
                    wallet:           userBalance,
                    hand:             [],
                    avatar:           `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.username}`,
                    isInHand:         true,
                    isPassing:        false,
                    passedCards:      [],
                    suspiciousClaims: fraudCount
                });
            }

            socket.join(tableId);
            socket.leave('salon_room');
            socket.salonTableId = salonId;
            socket.emit('wallet-update', { balance: userBalance });
            io.to(tableId).emit('player-list-update', table.players);
            const dealer = table.players[table.dealerIndex];
            if (dealer) io.to(tableId).emit('update-dealer', { dealerId: dealer.id });
            logAction(tableId, `${data.username} s'est assis à la table.`);
            scheduleBroadcastSalonState();

        } catch (err) {
            console.error('[sit-at-table]', err.message);
        }
    });

    // Joueur ou visiteur anonyme observe une table (sans siège)
    socket.on('observe-table', async (data) => {
        if (!data?.salon_table_id) return;
        const salonId = parseInt(data.salon_table_id, 10);
        const tableId = `salon_${salonId}`;

        // Résoudre userId si un username est fourni (joueur identifié)
        if (!socket.userId && data.username) {
            try {
                const { rows } = await db.query(
                    'SELECT id, status FROM users WHERE username=$1', [data.username]
                );
                if (rows.length && rows[0].status === 'active') {
                    socket.userId = rows[0].id;
                    connectedSockets.set(rows[0].id, socket.id);
                }
            } catch (err) {
                console.error('[observe-table] user lookup:', err.message);
            }
        }

        // Enregistrer en DB uniquement les joueurs identifiés
        if (socket.userId) {
            try {
                await db.query(
                    `INSERT INTO table_observers (table_id, user_id)
                     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [salonId, socket.userId]
                );
            } catch (err) {
                console.error('[observe-table] DB insert:', err.message);
            }
        }

        // Visiteurs anonymes et joueurs identifiés rejoignent la salle
        socket.join(tableId);
        socket.leave('salon_room');
        socket.salonObserving = salonId;

        // Envoyer l'état actuel de la table — sans les mains privées
        const table = tables[tableId];
        if (table) {
            const publicPlayers = table.players.map(p => ({
                id:       p.id,
                username: p.username,
                avatar:   p.avatar,
                wallet:   p.wallet,
                isInHand: p.isInHand,
                isPassing: p.isPassing
                // hand non transmise : lecture seule pour l'observateur
            }));
            socket.emit('player-list-update', publicPlayers);
            if (table.dealerIndex !== undefined) {
                const dealer = table.players[table.dealerIndex];
                if (dealer) socket.emit('update-dealer', { dealerId: dealer.id });
            }
        }
        if (socket.userId) scheduleBroadcastSalonState();
    });

    // Joueur quitte sa table (se lève ou arrête d'observer)
    socket.on('leave-table', async (data) => {
        if (!data?.salon_table_id) return;
        const salonId = parseInt(data.salon_table_id, 10);
        const tableId = `salon_${salonId}`;

        if (socket.userId) {
            try {
                await db.query('DELETE FROM table_seats    WHERE table_id=$1 AND user_id=$2', [salonId, socket.userId]);
                await db.query('DELETE FROM table_observers WHERE table_id=$1 AND user_id=$2', [salonId, socket.userId]);
            } catch (err) {
                console.error('[leave-table] DB cleanup:', err.message);
            }
        }

        // Retirer de la RAM uniquement si pas de partie en cours
        const table = tables[tableId];
        if (table && table.status === 'WAITING') {
            const pIdx = table.players.findIndex(p => p.id === socket.id);
            if (pIdx !== -1) {
                const player = table.players[pIdx];
                table.players.splice(pIdx, 1);
                logAction(tableId, `${player.username} a quitté la table.`);
                io.to(tableId).emit('player-list-update', table.players);
                if (table.players.length === 0) delete tables[tableId];
            }
        }

        socket.leave(tableId);
        socket.join('salon_room');
        socket.salonTableId  = null;
        socket.salonObserving = null;
        scheduleBroadcastSalonState();
    });

    // Joueur change de table (atomique : leave + sit)
    socket.on('change-table', async (data) => {
        if (!data?.from_table_id || !data?.to_table_id) return;
        const fromId  = parseInt(data.from_table_id, 10);
        const fromKey = `salon_${fromId}`;

        // Quitter la table actuelle
        if (socket.userId) {
            try {
                await db.query('DELETE FROM table_seats     WHERE table_id=$1 AND user_id=$2', [fromId, socket.userId]);
                await db.query('DELETE FROM table_observers WHERE table_id=$1 AND user_id=$2', [fromId, socket.userId]);
            } catch (err) {
                console.error('[change-table] DB cleanup:', err.message);
            }
        }
        const fromTable = tables[fromKey];
        if (fromTable && fromTable.status === 'WAITING') {
            const pIdx = fromTable.players.findIndex(p => p.id === socket.id);
            if (pIdx !== -1) {
                fromTable.players.splice(pIdx, 1);
                io.to(fromKey).emit('player-list-update', fromTable.players);
                if (fromTable.players.length === 0) delete tables[fromKey];
            }
        }
        socket.leave(fromKey);

        // Rediriger vers sit-at-table sur la nouvelle table
        socket.emit('change-table-ack', { salon_table_id: data.to_table_id });
    });

    // Attribution automatique de table — choisit la meilleure table disponible
    socket.on('auto-assign', async () => {
        try {
            const { rows } = await db.query(`
                SELECT st.id, st.name, st.min_bet, st.max_players,
                       COUNT(ts.id)::int AS seated_count
                FROM   salon_tables st
                LEFT   JOIN table_seats ts ON st.id = ts.table_id
                WHERE  st.status = 'open'
                GROUP  BY st.id
                HAVING COUNT(ts.id) < st.max_players
                ORDER  BY
                    CASE WHEN COUNT(ts.id) > 0 THEN 0 ELSE 1 END,
                    COUNT(ts.id) DESC,
                    st.id ASC
                LIMIT 1
            `);
            if (rows.length) {
                socket.emit('auto-assigned', {
                    salon_table_id: rows[0].id,
                    table_name:     rows[0].name,
                    min_bet:        rows[0].min_bet
                });
            } else {
                socket.emit('auto-assigned', { error: 'Aucune table disponible.' });
            }
        } catch (err) {
            console.error('[auto-assign]', err.message);
            socket.emit('auto-assigned', { error: 'Erreur serveur.' });
        }
    });

    // Admin crée une table via socket (alternative REST)
    socket.on('create-table', async (data) => {
        if (socket.userRole !== 'superadmin' && socket.userRole !== 'katika') {
            socket.emit('action-refused', { reason: 'Non autorisé.' });
            return;
        }
        try {
            const { rows } = await db.query(
                `INSERT INTO salon_tables (name, min_bet, max_players, created_by)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id, name, min_bet, max_players, status, invite_token`,
                [data.name || 'Nouvelle Table', data.min_bet || 100, data.max_players || 4, socket.userId]
            );
            socket.emit('table-created', rows[0]);
            scheduleBroadcastSalonState();
        } catch (err) {
            console.error('[create-table]', err.message);
        }
    });

    socket.on('disconnect', () => {
        if (socket.userId) connectedSockets.delete(socket.userId);

        // Salon 2.0 : nettoyer observateurs en DB
        if (socket.userId && socket.salonObserving) {
            db.query('DELETE FROM table_observers WHERE user_id=$1', [socket.userId])
                .catch(e => console.error('[disconnect] observer cleanup:', e.message));
        }

        for (const tId in tables) handleDeparture(socket, tId);
    });
});

// ============================================================
// Stats visiteurs en mémoire — aucune écriture SQL
// Diffusé toutes les 60s vers admin_room uniquement
// ============================================================
function computeOnlineStats() {
    let visitors = 0, authenticated = 0, inTable = 0;

    for (const [, sock] of io.sockets.sockets) {
        if (sock.userId) {
            authenticated++;
            if (sock.salonTableId || sock.salonObserving) inTable++;
        } else {
            visitors++;
        }
    }

    const tablesArr    = Object.values(tables);
    const activeTables = tablesArr.length;
    const playingTables = tablesArr.filter(t => t.status === 'PLAYING').length;

    return {
        visitors_online:     visitors,
        players_online:      authenticated,
        in_salon:            authenticated - inTable,
        in_game:             inTable,
        active_tables:       activeTables,
        playing_tables:      playingTables,
        total_connected:     visitors + authenticated
    };
}

setInterval(() => {
    if (io.sockets.sockets.size === 0) return;
    io.to('admin_room').emit('visitor:stats', computeOnlineStats());
}, 60_000);

// ============================================================
// Sprint 5 — Vérification périodique des statuts (toutes les 60s)
// ============================================================
setInterval(async () => {
    if (connectedSockets.size === 0) return;
    const ids = [...connectedSockets.keys()];
    try {
        const { rows } = await db.query(
            `SELECT id, status FROM users WHERE id=ANY($1) AND status!='active'`,
            [ids]
        );
        for (const { id, status } of rows) {
            const sockId = connectedSockets.get(id);
            if (!sockId) continue;
            const sock = io.sockets.sockets.get(sockId);
            if (!sock) continue;
            sock.emit('force-disconnect', {
                reason: `Compte ${status}. Veuillez contacter votre Katika.`
            });
            sock.disconnect(true);
            connectedSockets.delete(id);
            console.warn(`[STATUS CHECK] User #${id} (${status}) déconnecté de force.`);
        }
    } catch (err) {
        console.error('[STATUS CHECK]', err.message);
    }
}, 60_000);

// ============================================================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Serveur Fap Fap 2026 opérationnel sur port ${PORT}`));
