// =====================================================
// FAP FAP 2.1 — Salon de jeu — Entrée libre
// Visiteurs anonymes autorisés — JWT optionnel
// =====================================================

const token  = localStorage.getItem('token');
const user   = (() => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } })();
const isAuth = !!(token && user);

localStorage.removeItem('salon_table_id');
localStorage.removeItem('salon_observer');

let myWallet         = isAuth ? (parseFloat(user.wallet) || 0) : 0;
let myAcademyBalance = 0;

// ── Header dynamique ──────────────────────────────
const headerArea = document.getElementById('header-user-area');
if (isAuth) {
    headerArea.innerHTML = `
        <span>Connecté : <strong>${user.username}</strong></span>
        <span id="wallet-display">${myWallet.toLocaleString()} FCFA</span>
        <span id="jetons-display" title="Solde Académie — cliquer pour voir l'historique" style="display:none">0 🎫</span>
        <span id="rs-badge-slot"></span>
        <button class="btn-logout" onclick="logout()">Déconnexion</button>`;
    document.getElementById('visitor-banner').style.display = 'none';
} else {
    headerArea.innerHTML = `
        <span style="color:#888">Mode Observateur</span>
        <button style="background:transparent;border:1px solid #555;color:#aaa;border-radius:6px;padding:6px 14px;font-size:0.8rem;cursor:pointer;" onclick="openModalLogin()">Se connecter</button>
        <button style="background:var(--gold);color:#000;border:none;border-radius:6px;padding:6px 14px;font-size:0.8rem;font-weight:bold;cursor:pointer;" onclick="openModalRegister()">S'inscrire</button>`;
    document.getElementById('visitor-banner').style.display = 'flex';
}

if (isAuth && (user.role === 'superadmin' || user.role === 'katika')) {
    document.getElementById('admin-panel').classList.add('visible');
}

let selectedTable  = null;
let selectedAmount = 0;

// =====================================================
// SOCKET
// =====================================================

const socket = io(BACKEND_URL);

socket.on('connect', () => {
    setStatus(true);
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

socket.on('authenticated', () => refreshWalletDisplay());

socket.on('salon-state', (tables) => renderTables(tables));

socket.on('auto-assigned', (data) => {
    if (data.error) {
        document.getElementById('salon-subtitle').innerText = 'Aucune table disponible — choisissez ci-dessous.';
        return;
    }
    openSitModal({ table_id: data.salon_table_id, table_name: data.table_name, min_bet: data.min_bet });
});

socket.on('invite-resolved', (data) => {
    if (!data || data.error) { showToast('Lien d\'invitation invalide ou table fermée.', true); return; }
    openSitModal(data);
});

socket.on('tokens:approved', ({ new_balance, amount }) => {
    myWallet = new_balance;
    const disp = document.getElementById('wallet-display');
    if (disp) disp.textContent = myWallet.toLocaleString() + ' FCFA';
    const u = JSON.parse(localStorage.getItem('user') || '{}');
    u.wallet = new_balance;
    localStorage.setItem('user', JSON.stringify(u));
    showToast(`Jetons validés ! +${amount.toLocaleString()} FCFA — Vous pouvez maintenant vous asseoir.`);
});

socket.on('tokens:rejected', ({ reason }) => {
    showToast(`Demande refusée : ${reason}`, true);
});

socket.on('academy:daily-claimed', ({ granted, new_balance }) => {
    myAcademyBalance = new_balance;
    updateAcademyWidget(false);
    showToast(`+${granted.toLocaleString()} JETONS ajoutés ! Bonne chance à l'Académie.`);
});

// =====================================================
// RENDU DES TABLES — SÉPARÉ ACADÉMIE / RÉEL
// =====================================================

function renderTables(tables) {
    if (!tables || tables.length === 0) {
        showSection('academy', []);
        showSection('real', []);
        return;
    }

    const academyTables = tables.filter(t => (t.table_type || 'real') === 'academy');
    const realTables    = tables.filter(t => (t.table_type || 'real') !== 'academy');

    showSection('academy', academyTables);
    showSection('real',    realTables);
}

function showSection(type, tables) {
    const section  = document.getElementById(`section-${type}`);
    const grid     = document.getElementById(`grid-${type}`);
    const loading  = document.getElementById(`loading-${type}`);
    const noTables = document.getElementById(`no-${type}`);

    section.style.display = 'block';
    loading.style.display  = 'none';

    if (!tables.length) {
        grid.style.display     = 'none';
        noTables.style.display = 'block';
        return;
    }

    noTables.style.display = 'none';
    grid.style.display     = 'grid';
    grid.innerHTML         = '';

    tables.forEach(t => grid.appendChild(buildCard(t)));
}

function buildCard(t) {
    const isAcademy   = (t.table_type || 'real') === 'academy';
    const currency    = t.currency || (isAcademy ? 'JETONS' : 'FCFA');
    const seated      = Array.isArray(t.seated_players) ? t.seated_players : [];
    const obs         = Array.isArray(t.observers)      ? t.observers      : [];
    const maxP        = t.max_players || 4;
    const livePl      = t.live_players !== undefined ? t.live_players : seated.length;
    const avail       = maxP - livePl;
    const isPlaying   = t.status === 'playing';
    const isFull      = avail <= 0;
    const isReady     = !isPlaying && livePl >= 1; // quelqu'un attend déjà

    const card = document.createElement('div');
    card.className = `table-card status-${t.status}${isAcademy ? ' academy' : ''}`;

    const seatsHtml = Array.from({ length: maxP }, (_, i) =>
        `<div class="seat-dot ${i < livePl ? 'taken' : 'free'}${isAcademy ? ' academy' : ''}"></div>`
    ).join('');

    const playersHtml = seated.length
        ? seated.map(p => `<span class="player-chip">${p.username}</span>`).join('')
        : '<em style="color:#555">Aucun joueur</em>';

    const obsText = obs.length ? ` · ${obs.length} observateur${obs.length > 1 ? 's' : ''}` : '';

    // Bouton s'asseoir
    let sitLabel, sitDisabled, sitOnclick, sitClass;
    sitClass = isAcademy ? 'btn-sit-table academy' : 'btn-sit-table';
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

    // Badge statut
    let badgeHtml;
    if (isPlaying) {
        badgeHtml = `<span class="table-status-badge badge-playing">En cours</span>`;
    } else if (isReady) {
        badgeHtml = `<span class="table-status-badge badge-ready">🟢 Prêt</span>`;
    } else {
        badgeHtml = `<span class="table-status-badge badge-open">Libre</span>`;
    }

    card.innerHTML = `
        <div class="table-card-header">
            <span class="table-card-name">${t.table_name}</span>
            ${badgeHtml}
        </div>
        <div class="table-card-info">
            <span>Mise min : <strong>${parseFloat(t.min_bet).toLocaleString()} ${currency}</strong></span>
            <span>Places : <strong>${livePl}/${maxP}</strong>${obsText}</span>
            ${t.club_name ? `<span>Club : <strong>${t.club_name}</strong></span>` : ''}
            ${isReady ? `<span class="immediately-tag">▶ Jouable immédiatement</span>` : ''}
        </div>
        <div class="seats-bar">${seatsHtml}</div>
        <div class="players-list">${playersHtml}</div>
        <div class="table-card-actions">
            <button class="${sitClass}" ${sitDisabled} ${sitOnclick}>${sitLabel}</button>
            <button class="btn-observe" onclick='openObserveModal(${JSON.stringify(t)})'>Observer</button>
        </div>`;

    return card;
}

// =====================================================
// ANNONCES
// =====================================================

const TYPE_META = {
    INFO:        { color: '#3498db', icon: 'ℹ️'  },
    TOURNAMENT:  { color: '#e67e22', icon: '🏆'  },
    PROMOTION:   { color: '#2ecc71', icon: '🎁'  },
    MAINTENANCE: { color: '#e74c3c', icon: '⚠️'  },
    UPDATE:      { color: '#9b59b6', icon: '🆕'  },
    WARNING:     { color: '#f39c12', icon: '🚨'  }
};

async function loadAnnouncements() {
    try {
        const r = await fetch(BACKEND_URL + '/api/announcements');
        if (!r.ok) return;
        const { announcements } = await r.json();
        if (!announcements?.length) return;

        const zone = document.getElementById('announcements-zone');
        zone.innerHTML = '';
        announcements.forEach(ann => {
            const meta  = TYPE_META[ann.announcement_type] || TYPE_META.INFO;
            const links = [
                ann.channel_whatsapp && { label: 'WhatsApp', url: ann.channel_whatsapp },
                ann.channel_telegram && { label: 'Telegram', url: ann.channel_telegram },
                ann.channel_discord  && { label: 'Discord',  url: ann.channel_discord  },
                ann.channel_facebook && { label: 'Facebook', url: ann.channel_facebook }
            ].filter(Boolean);

            const linksHtml = links.map(l =>
                `<a class="ann-link" href="${l.url}" target="_blank" rel="noopener"
                    style="color:${meta.color};border-color:${meta.color}30">${l.label}</a>`
            ).join(' ');

            const card = document.createElement('div');
            card.className = 'announcement-card';
            card.style.borderColor = meta.color;
            card.innerHTML = `
                <div class="ann-icon">${meta.icon}</div>
                <div class="ann-body">
                    <div class="ann-title" style="color:${meta.color}">
                        ${ann.title}
                        ${ann.pinned ? '<span class="ann-pinned-badge">📌 Épinglé</span>' : ''}
                    </div>
                    <div class="ann-text">${ann.body}</div>
                    ${linksHtml}
                </div>`;
            zone.appendChild(card);
        });
    } catch { /* silencieux — les annonces sont non critiques */ }
}

socket.on('announcement:new', (ann) => {
    loadAnnouncements();
});

// =====================================================
// WALLET ACADÉMIE
// =====================================================

async function loadAcademyWallet() {
    if (!token) return;
    try {
        const r = await fetch(BACKEND_URL + '/api/academy/wallet', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!r.ok) return;
        const data = await r.json();
        myAcademyBalance = data.balance || 0;
        updateAcademyWidget(data.can_claim, data.next_grant);
    } catch { /* silencieux */ }
}

function updateAcademyWidget(canClaim, nextGrant) {
    const widget  = document.getElementById('academy-wallet-widget');
    const balEl   = document.getElementById('academy-balance-val');
    const btnEl   = document.getElementById('btn-claim-daily');
    const timerEl = document.getElementById('claim-timer');
    const jEl     = document.getElementById('jetons-display');

    if (!widget) return;
    widget.style.display = 'flex';

    if (balEl) balEl.textContent = myAcademyBalance.toLocaleString('fr-FR') + ' 🎫';
    if (jEl)  { jEl.style.display = 'inline'; jEl.textContent = myAcademyBalance.toLocaleString('fr-FR') + ' 🎫'; }

    if (btnEl) {
        if (canClaim) {
            btnEl.style.display = 'inline-block';
            btnEl.disabled      = false;
            if (timerEl) timerEl.style.display = 'none';
        } else {
            btnEl.style.display = 'none';
            if (timerEl && nextGrant) {
                const next = new Date(nextGrant);
                timerEl.style.display = 'inline';
                timerEl.textContent   = `Disponible à ${next.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
            } else if (timerEl) {
                timerEl.style.display = 'none';
            }
        }
    }
}

async function claimDailyGrant() {
    const btn = document.getElementById('btn-claim-daily');
    if (btn) { btn.disabled = true; btn.textContent = '…'; }

    try {
        const r = await fetch(BACKEND_URL + '/api/academy/daily-grant', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await r.json();

        if (!r.ok) {
            showToast(data.msg || 'Impossible de récupérer les jetons.', true);
            if (data.next_grant) updateAcademyWidget(false, data.next_grant);
            else if (btn) { btn.disabled = false; btn.textContent = '+ 10 000 JETONS'; }
            return;
        }

        myAcademyBalance = data.new_balance;
        updateAcademyWidget(false, null);
        showToast(`+${data.granted.toLocaleString()} JETONS ajoutés !`);
    } catch {
        showToast('Erreur réseau.', true);
        if (btn) { btn.disabled = false; btn.textContent = '+ 10 000 JETONS'; }
    }
}

// =====================================================
// MODALS — ASSEOIR / OBSERVER
// =====================================================

function openSitModal(table) {
    if (!isAuth) { openModalRegister(); return; }
    selectedTable = table;
    const isAcademy = (table.table_type || 'real') === 'academy';
    const currency  = table.currency || (isAcademy ? 'JETONS' : 'FCFA');
    const balance   = isAcademy ? myAcademyBalance : myWallet;

    document.getElementById('modal-sit-title').innerText          = `S'asseoir — ${table.table_name}`;
    document.getElementById('modal-sit-bet').innerText            = parseFloat(table.min_bet).toLocaleString('fr-FR');
    document.getElementById('modal-sit-currency').innerText       = currency;
    document.getElementById('modal-sit-wallet').innerText         = balance.toLocaleString('fr-FR');
    document.getElementById('modal-sit-wallet-currency').innerText = currency;
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
    const isAcademy = (selectedTable.table_type || 'real') === 'academy';
    const balance   = isAcademy ? myAcademyBalance : myWallet;

    if (balance < parseFloat(selectedTable.min_bet)) {
        closeModals();
        if (isAcademy) {
            showToast('Solde JETONS insuffisant. Récupérez votre crédit quotidien.', true);
        } else {
            showToast('Solde insuffisant. Demandez des jetons à votre Katika.', true);
            setTimeout(() => openModalTokens(), 1200);
        }
        return;
    }

    // Stocker la devise pour que game.js l'utilise
    localStorage.setItem('salon_table_id',   selectedTable.table_id);
    localStorage.setItem('table_currency',   selectedTable.currency || (isAcademy ? 'JETONS' : 'FCFA'));
    localStorage.setItem('table_type',       selectedTable.table_type || 'real');
    localStorage.removeItem('salon_observer');
    closeModals();
    window.location.href = 'game.html';
}

function confirmObserve() {
    if (!selectedTable) return;
    localStorage.setItem('salon_table_id',  selectedTable.table_id);
    localStorage.setItem('table_currency',  selectedTable.currency || 'FCFA');
    localStorage.setItem('table_type',      selectedTable.table_type || 'real');
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
    const phone     = document.getElementById('reg-phone').value.trim();
    const uname     = document.getElementById('reg-username').value.trim();
    const pass      = document.getElementById('reg-password').value;
    const pass2     = document.getElementById('reg-password2').value;
    const firstName = document.getElementById('reg-firstname').value.trim() || undefined;
    const lastName  = document.getElementById('reg-lastname').value.trim()  || undefined;

    if (!phone || !uname || !pass) { setError('reg', 'Téléphone, sobriquet et mot de passe sont requis.'); return; }
    if (pass !== pass2)            { setError('reg', 'Les mots de passe ne correspondent pas.'); return; }
    if (uname.length < 2)          { setError('reg', 'Le sobriquet doit contenir au moins 2 caractères.'); return; }
    if (pass.length < 6)           { setError('reg', 'Mot de passe trop court (6 caractères minimum).'); return; }

    try {
        const r = await fetch(BACKEND_URL + '/api/auth/register-or-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, username: uname, password: pass, first_name: firstName, last_name: lastName })
        });
        const data = await r.json();

        if (!r.ok) { setError('reg', data.msg || 'Erreur lors de l\'inscription.'); return; }

        if (!data.isNew) {
            setError('reg', 'Ce numéro est déjà enregistré. Connectez-vous à la place.');
            return;
        }

        localStorage.setItem('token', data.token);
        localStorage.setItem('user',  JSON.stringify(data.user));
        closeModals();
        showToast('Compte créé ! Bienvenue ' + data.user.username + ' — 10 000 JETONS offerts 🎫');
        socket.emit('authenticate', data.token);
        setTimeout(() => window.location.reload(), 1500);

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
// MODAL : DEMANDE DE JETONS (FCFA)
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
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + currentToken },
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
    const min_bet     = parseInt(document.getElementById('new-table-bet').value)     || 100;
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
// WALLET FCFA — RAFRAÎCHIR DEPUIS LA BDD
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
    window._toastTimer = setTimeout(() => { t.style.display = 'none'; }, 4500);
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

// =====================================================
// INIT AU CHARGEMENT
// =====================================================

loadAnnouncements();
if (isAuth) {
    refreshWalletDisplay();
    loadAcademyWallet().then(() => {
        // Afficher le widget uniquement si connecté
        const w = document.getElementById('academy-wallet-widget');
        if (w) w.style.display = 'flex';
    });
}
