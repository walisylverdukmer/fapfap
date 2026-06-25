// =====================================================
// FAP FAP 2.0 — Salon de jeu — Entrée libre
// Visiteurs anonymes autorisés — JWT optionnel
// =====================================================

const token   = localStorage.getItem('token');
const user    = (() => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } })();
const isAuth  = !!(token && user);
let   myWallet = isAuth ? (parseFloat(user.wallet) || 0) : 0;

localStorage.removeItem('salon_table_id');
localStorage.removeItem('salon_observer');

// ── Header dynamique ───────────────────────────────
const headerArea = document.getElementById('header-user-area');
if (isAuth) {
    headerArea.innerHTML = `
        <span>Connecté : <strong>${user.username}</strong></span>
        <span id="wallet-display">${myWallet.toLocaleString()} FCFA</span>
        <span id="rs-badge-slot"></span>
        <button class="btn-logout" onclick="logout()">Déconnexion</button>`;
    document.getElementById('visitor-banner').style.display = 'none';
} else {
    headerArea.innerHTML = `
        <span style="color:#888">Mode Observateur</span>
        <button style="background:transparent;border:1px solid #555;color:#aaa;border-radius:6px;padding:6px 14px;font-size:0.8rem;cursor:pointer;" onclick="openModalLogin()">Se connecter</button>
        <button id="btn-want-play-header" style="background:var(--gold);color:#000;border:none;border-radius:6px;padding:6px 14px;font-size:0.8rem;font-weight:bold;cursor:pointer;" onclick="openModalRegister()">S'inscrire</button>`;
    document.getElementById('visitor-banner').style.display = 'flex';
}

// Panel admin visible si superadmin ou katika
if (isAuth && (user.role === 'superadmin' || user.role === 'katika')) {
    document.getElementById('admin-panel').classList.add('visible');
}

// Table sélectionnée (pour les modals)
let selectedTable   = null;
let selectedAmount  = 0;

// =====================================================
// CONNEXION SOCKET
// =====================================================

const socket = io(BACKEND_URL);

socket.on('connect', () => {
    setStatus(true);

    // Authentifier via Socket.IO si token disponible
    if (token) socket.emit('authenticate', token);

    socket.emit('join-salon');

    const params = new URLSearchParams(window.location.search);
    const inviteToken = params.get('invite');
    if (inviteToken) socket.emit('table-invite', { token: inviteToken });

    if (params.get('auto') === '1') {
        document.getElementById('salon-subtitle').innerText = 'Recherche d\'une table disponible...';
        if (isAuth) socket.emit('auto-assign');
    }
});

socket.on('disconnect', () => setStatus(false));

// Confirmation d'authentification socket — rafraîchir le wallet
socket.on('authenticated', () => {
    refreshWalletDisplay();
});

// =====================================================
// ÉTAT DU SALON
// =====================================================

socket.on('salon-state', (tables) => renderTables(tables));

// =====================================================
// ATTRIBUTION AUTOMATIQUE
// =====================================================

socket.on('auto-assigned', (data) => {
    if (data.error) {
        document.getElementById('salon-subtitle').innerText = 'Aucune table disponible — choisissez ci-dessous.';
        return;
    }
    openSitModal({ table_id: data.salon_table_id, table_name: data.table_name, min_bet: data.min_bet });
});

// =====================================================
// INVITATION PAR LIEN
// =====================================================

socket.on('invite-resolved', (data) => {
    if (!data || data.error) { showToast('Lien d\'invitation invalide ou table fermée.', true); return; }
    openSitModal(data);
});

// =====================================================
// NOTIFICATIONS JOUEUR (tokens approuvés/rejetés)
// =====================================================

socket.on('tokens:approved', ({ new_balance, amount }) => {
    myWallet = new_balance;
    if (isAuth) {
        const disp = document.getElementById('wallet-display');
        if (disp) disp.textContent = myWallet.toLocaleString() + ' FCFA';
        // Mettre à jour le localStorage
        const u = JSON.parse(localStorage.getItem('user') || '{}');
        u.wallet = new_balance;
        localStorage.setItem('user', JSON.stringify(u));
    }
    showToast(`Jetons validés ! +${amount.toLocaleString()} FCFA — Vous pouvez maintenant vous asseoir.`);
});

socket.on('tokens:rejected', ({ reason }) => {
    showToast(`Demande refusée : ${reason}`, true);
});

// =====================================================
// RENDU DES TABLES
// =====================================================

function renderTables(tables) {
    const grid    = document.getElementById('tables-grid');
    const loading = document.getElementById('loading-msg');

    if (!tables || tables.length === 0) {
        loading.style.display = 'block';
        loading.innerText = 'Aucune table disponible pour le moment.';
        grid.style.display = 'none';
        return;
    }

    loading.style.display = 'none';
    grid.style.display = 'grid';
    grid.innerHTML = '';

    tables.forEach(t => {
        const card     = document.createElement('div');
        card.className = `table-card status-${t.status}`;

        const seated    = Array.isArray(t.seated_players) ? t.seated_players : [];
        const obs       = Array.isArray(t.observers)      ? t.observers      : [];
        const maxP      = t.max_players || 4;
        const livePl    = t.live_players !== undefined ? t.live_players : seated.length;
        const avail     = maxP - livePl;
        const isPlaying = t.status === 'playing';
        const isFull    = avail <= 0;

        const seatsHtml   = Array.from({ length: maxP }, (_, i) =>
            `<div class="seat-dot ${i < livePl ? 'taken' : 'free'}"></div>`).join('');
        const playersHtml = seated.length
            ? seated.map(p => `<span class="player-chip">${p.username}</span>`).join('')
            : '<em>Aucun joueur</em>';
        const obsText = obs.length ? `${obs.length} observateur${obs.length > 1 ? 's' : ''}` : '';

        // Bouton s'asseoir — comportement différent selon l'état
        let sitLabel, sitDisabled, sitOnclick;
        if (isPlaying) {
            sitLabel = 'Partie en cours'; sitDisabled = 'disabled'; sitOnclick = '';
        } else if (isFull) {
            sitLabel = 'Complet'; sitDisabled = 'disabled'; sitOnclick = '';
        } else if (!isAuth) {
            sitLabel = 'Je veux jouer'; sitDisabled = '';
            sitOnclick = `onclick="openModalRegister()"`;
        } else {
            sitLabel = 'S\'asseoir'; sitDisabled = '';
            sitOnclick = `onclick='openSitModal(${JSON.stringify(t)})'`;
        }

        card.innerHTML = `
            <div class="table-card-header">
                <span class="table-card-name">${t.table_name}</span>
                <span class="table-status-badge badge-${t.status}">
                    ${t.status === 'playing' ? 'En cours' : 'Libre'}
                </span>
            </div>
            <div class="table-card-info">
                <span>Mise min : <strong>${t.min_bet} FCFA</strong></span>
                <span>Places : <strong>${livePl}/${maxP}</strong>${obsText ? ` · ${obsText}` : ''}</span>
                ${t.club_name ? `<span>Club : <strong>${t.club_name}</strong></span>` : ''}
            </div>
            <div class="seats-bar">${seatsHtml}</div>
            <div class="players-list">${playersHtml}</div>
            <div class="table-card-actions">
                <button class="btn-sit-table" ${sitDisabled} ${sitOnclick}>
                    ${sitLabel}
                </button>
                <button class="btn-observe" onclick='openObserveModal(${JSON.stringify(t)})'>
                    Observer
                </button>
            </div>`;

        grid.appendChild(card);
    });
}

// =====================================================
// MODALS — ASSEOIR / OBSERVER
// =====================================================

function openSitModal(table) {
    if (!isAuth) { openModalRegister(); return; }
    selectedTable = table;
    document.getElementById('modal-sit-title').innerText  = `S'asseoir — ${table.table_name}`;
    document.getElementById('modal-sit-bet').innerText    = parseFloat(table.min_bet).toLocaleString();
    document.getElementById('modal-sit-wallet').innerText = myWallet.toLocaleString();
    document.getElementById('modal-sit').classList.add('open');
}

function openObserveModal(table) {
    selectedTable = table;
    document.getElementById('modal-obs-title').innerText = `Observer — ${table.table_name}`;
    document.getElementById('modal-observe').classList.add('open');
}

function closeModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
    clearErrors();
    selectedTable = null;
}

function closeModalsAndReload() {
    closeModals();
    setTimeout(() => window.location.reload(), 400);
}

function confirmSit() {
    if (!selectedTable) return;
    if (myWallet < parseFloat(selectedTable.min_bet)) {
        closeModals();
        showToast('Solde insuffisant. Demandez des jetons à votre Katika.', true);
        setTimeout(() => openModalTokens(), 1200);
        return;
    }
    localStorage.setItem('salon_table_id', selectedTable.table_id);
    localStorage.removeItem('salon_observer');
    closeModals();
    window.location.href = 'game.html';
}

function confirmObserve() {
    if (!selectedTable) return;
    localStorage.setItem('salon_table_id', selectedTable.table_id);
    localStorage.setItem('salon_observer', '1');
    socket.emit('observe-table', {
        salon_table_id: selectedTable.table_id,
        username: isAuth ? user.username : null
    });
    closeModals();
    window.location.href = 'game.html';
}

// =====================================================
// MODAL : INSCRIPTION
// =====================================================

function openModalRegister() {
    closeModals();
    document.getElementById('modal-register').classList.add('open');
}

async function submitRegister() {
    const phone  = document.getElementById('reg-phone').value.trim();
    const uname  = document.getElementById('reg-username').value.trim();
    const pass   = document.getElementById('reg-password').value;
    const pass2  = document.getElementById('reg-password2').value;

    if (!phone || !uname || !pass) { setError('reg', 'Tous les champs sont requis.'); return; }
    if (pass !== pass2)            { setError('reg', 'Les mots de passe ne correspondent pas.'); return; }
    if (uname.length < 2)          { setError('reg', 'Le sobriquet doit contenir au moins 2 caractères.'); return; }
    if (pass.length < 6)           { setError('reg', 'Mot de passe trop court (6 caractères minimum).'); return; }

    try {
        const r = await fetch(BACKEND_URL + '/api/auth/register-or-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, username: uname, password: pass })
        });
        const data = await r.json();

        if (!r.ok) { setError('reg', data.msg || 'Erreur lors de l\'inscription.'); return; }

        if (!data.isNew) {
            // Numéro déjà existant → proposer connexion
            setError('reg', 'Ce numéro est déjà enregistré. Connectez-vous à la place.');
            return;
        }

        // Succès — stocker le token et rafraîchir
        localStorage.setItem('token', data.token);
        localStorage.setItem('user',  JSON.stringify(data.user));
        closeModals();
        showToast('Compte créé ! Bienvenue ' + data.user.username);

        // Reconnexion Socket.IO authentifiée
        socket.emit('authenticate', data.token);

        // Proposer la demande de jetons après le toast
        setTimeout(() => openModalTokens(), 900);

    } catch { setError('reg', 'Erreur réseau. Réessayez.'); }
}

// =====================================================
// MODAL : CONNEXION
// =====================================================

function openModalLogin() {
    closeModals();
    document.getElementById('modal-login').classList.add('open');
}

async function submitLogin() {
    const phone = document.getElementById('login-phone').value.trim();
    const pass  = document.getElementById('login-password').value;

    if (!phone || !pass) { setError('login', 'Téléphone et mot de passe requis.'); return; }

    try {
        const r = await fetch(BACKEND_URL + '/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, password: pass })
        });
        const data = await r.json();

        if (!r.ok) { setError('login', data.msg || 'Identifiants incorrects.'); return; }

        localStorage.setItem('token', data.token);
        localStorage.setItem('user',  JSON.stringify(data.user));
        closeModals();
        window.location.reload();

    } catch { setError('login', 'Erreur réseau.'); }
}

// =====================================================
// MODAL : DEMANDE DE JETONS
// =====================================================

function openModalTokens() {
    closeModals();
    selectedAmount = 0;
    document.querySelectorAll('.token-btn').forEach(b => b.classList.remove('selected'));
    document.getElementById('tokens-custom').value = '';
    document.getElementById('tokens-note').value   = '';
    document.getElementById('modal-tokens').classList.add('open');
}

function selectAmount(amount, btn) {
    selectedAmount = amount;
    document.querySelectorAll('.token-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    document.getElementById('tokens-custom').value = '';
}

function clearAmountSelection() {
    selectedAmount = 0;
    document.querySelectorAll('.token-btn').forEach(b => b.classList.remove('selected'));
}

async function submitTokenRequest() {
    const custom = parseInt(document.getElementById('tokens-custom').value) || 0;
    const amount = custom || selectedAmount;
    const note   = document.getElementById('tokens-note').value.trim();

    if (!amount || amount < 500) { setError('tokens', 'Montant minimum : 500 FCFA.'); return; }

    const currentToken = localStorage.getItem('token');
    if (!currentToken) { setError('tokens', 'Vous devez être connecté pour faire une demande.'); return; }

    try {
        const r = await fetch(BACKEND_URL + '/api/money/recharge', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + currentToken
            },
            body: JSON.stringify({ amount, note: note || undefined })
        });
        const data = await r.json();

        if (!r.ok) { setError('tokens', data.msg || 'Erreur lors de la demande.'); return; }

        closeModals();
        showToast('Demande envoyée ! Votre Katika va valider la recharge.');
        setTimeout(() => window.location.reload(), 2000);

    } catch { setError('tokens', 'Erreur réseau.'); }
}

// =====================================================
// ADMIN — CRÉER UNE TABLE
// =====================================================

function createTable() {
    const name        = document.getElementById('new-table-name').value.trim();
    const min_bet     = parseInt(document.getElementById('new-table-bet').value) || 100;
    const max_players = parseInt(document.getElementById('new-table-players').value) || 4;

    if (!name) { showToast('Donnez un nom à la table.', true); return; }

    fetch(BACKEND_URL + '/api/salon/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ name, min_bet, max_players })
    })
    .then(r => r.json())
    .then(data => {
        if (data.msg && !data.id) { showToast(data.msg, true); return; }
        document.getElementById('new-table-name').value = '';
        showToast('Table créée avec succès.');
    })
    .catch(() => showToast('Erreur réseau.', true));
}

// =====================================================
// WALLET — RAFRAÎCHIR DEPUIS LA BDD
// =====================================================

async function refreshWalletDisplay() {
    if (!token) return;
    try {
        const r = await fetch(BACKEND_URL + '/api/money/balance', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!r.ok) return;
        const data = await r.json();
        myWallet = parseFloat(data.balance) || 0;
        const disp = document.getElementById('wallet-display');
        if (disp) disp.textContent = myWallet.toLocaleString() + ' FCFA';
        const u = JSON.parse(localStorage.getItem('user') || '{}');
        u.wallet = myWallet;
        localStorage.setItem('user', JSON.stringify(u));
    } catch { /* silencieux */ }
}

// =====================================================
// UTILITAIRES
// =====================================================

function setStatus(connected) {
    const el = document.getElementById('connection-status');
    el.className = connected ? 'connected' : 'disconnected';
    el.innerText  = connected ? 'Connecté' : 'Déconnecté';
}

function setError(prefix, msg) {
    const el = document.getElementById(prefix + '-error');
    if (el) el.textContent = msg;
}

function clearErrors() {
    document.querySelectorAll('.modal-error').forEach(el => el.textContent = '');
}

function showToast(msg, isError = false) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className   = isError ? 'error' : '';
    t.style.display = 'block';
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => { t.style.display = 'none'; }, 4000);
}

function logout() {
    socket.disconnect();
    localStorage.clear();
    sessionStorage.clear();
    window.location.replace('index.html');
}

// Fermer modal en cliquant hors du box
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModals(); });
});

// Rafraîchir le wallet au chargement si connecté
if (isAuth) refreshWalletDisplay();
