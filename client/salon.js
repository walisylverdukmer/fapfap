// =====================================================
// FAP FAP 2.0 — Salon de jeu dynamique
// =====================================================

const socket = io(BACKEND_URL);
const user   = JSON.parse(localStorage.getItem('user'));
const token  = localStorage.getItem('token');

// Nettoyage salon_table_id d'une session précédente
localStorage.removeItem('salon_table_id');
localStorage.removeItem('salon_observer');

// Vérification auth
if (!user || !token) {
    window.location.replace('index.html');
}

// Afficher le nom en header
document.getElementById('header-username').innerText = user.username || '—';

// Panel admin visible si superadmin ou katika
if (user.role === 'superadmin' || user.role === 'katika') {
    document.getElementById('admin-panel').classList.add('visible');
}

// Table sélectionnée (pour les modals)
let selectedTable = null;

// =====================================================
// CONNEXION SOCKET
// =====================================================

socket.on('connect', () => {
    setStatus(true);
    socket.emit('join-salon');

    // Gestion lien d'invitation dans l'URL (?invite=TOKEN)
    const params = new URLSearchParams(window.location.search);
    const inviteToken = params.get('invite');
    if (inviteToken) {
        socket.emit('table-invite', { token: inviteToken });
    }
});

socket.on('disconnect', () => setStatus(false));

// =====================================================
// ÉTAT DU SALON
// =====================================================

socket.on('salon-state', (tables) => {
    renderTables(tables);
});

// =====================================================
// INVITATION PAR LIEN
// =====================================================

socket.on('invite-resolved', (data) => {
    if (!data || data.error) {
        alert('Lien d\'invitation invalide ou table fermée.');
        return;
    }
    // Ouvrir directement le modal "s'asseoir" pour cette table
    openSitModal(data);
});

// =====================================================
// RENDU DES TABLES
// =====================================================

function renderTables(tables) {
    const grid = document.getElementById('tables-grid');
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
        const card = document.createElement('div');
        card.className = `table-card status-${t.status}`;

        const seated  = Array.isArray(t.seated_players) ? t.seated_players : [];
        const obs     = Array.isArray(t.observers) ? t.observers : [];
        const maxP    = t.max_players || 4;
        const livePl  = t.live_players !== undefined ? t.live_players : seated.length;
        const avail   = maxP - livePl;
        const isPlaying = t.status === 'playing';
        const isFull    = avail <= 0;

        // Badges sièges
        const seatsHtml = Array.from({ length: maxP }, (_, i) => {
            const taken = i < livePl;
            return `<div class="seat-dot ${taken ? 'taken' : 'free'}"></div>`;
        }).join('');

        // Joueurs assis
        const playersHtml = seated.length
            ? seated.map(p => `<span class="player-chip">${p.username}</span>`).join('')
            : '<em>Aucun joueur</em>';

        // Observateurs
        const obsText = obs.length ? `${obs.length} observateur${obs.length > 1 ? 's' : ''}` : '';

        // Bouton s'asseoir
        const canSit = !isPlaying && !isFull;
        const sitDisabled = canSit ? '' : 'disabled';

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
                <button class="btn-sit-table" ${sitDisabled}
                    onclick='openSitModal(${JSON.stringify(t)})'>
                    ${isPlaying ? 'Partie en cours' : isFull ? 'Complet' : "S'asseoir"}
                </button>
                <button class="btn-observe" onclick='openObserveModal(${JSON.stringify(t)})'>
                    Observer
                </button>
            </div>`;

        grid.appendChild(card);
    });
}

// =====================================================
// MODALS
// =====================================================

function openSitModal(table) {
    selectedTable = table;
    document.getElementById('modal-sit-title').innerText = `S'asseoir — ${table.table_name}`;
    document.getElementById('modal-sit-bet').innerText   = table.min_bet;
    document.getElementById('modal-sit').classList.add('open');
}

function openObserveModal(table) {
    selectedTable = table;
    document.getElementById('modal-obs-title').innerText = `Observer — ${table.table_name}`;
    document.getElementById('modal-observe').classList.add('open');
}

function closeModals() {
    document.getElementById('modal-sit').classList.remove('open');
    document.getElementById('modal-observe').classList.remove('open');
    selectedTable = null;
}

function confirmSit() {
    if (!selectedTable) return;
    localStorage.setItem('salon_table_id', selectedTable.table_id);
    localStorage.removeItem('salon_observer');
    closeModals();
    window.location.href = 'game.html';
}

function confirmObserve() {
    if (!selectedTable) return;
    localStorage.setItem('salon_table_id', selectedTable.table_id);
    localStorage.setItem('salon_observer', '1');
    socket.emit('observe-table', { salon_table_id: selectedTable.table_id });
    closeModals();
    window.location.href = 'game.html';
}

// Fermer modal en cliquant hors du box
document.getElementById('modal-sit').addEventListener('click', function(e) {
    if (e.target === this) closeModals();
});
document.getElementById('modal-observe').addEventListener('click', function(e) {
    if (e.target === this) closeModals();
});

// =====================================================
// ADMIN — CRÉER UNE TABLE
// =====================================================

function createTable() {
    const name       = document.getElementById('new-table-name').value.trim();
    const min_bet    = parseInt(document.getElementById('new-table-bet').value) || 100;
    const max_players = parseInt(document.getElementById('new-table-players').value) || 4;

    if (!name) {
        alert('Donnez un nom à la table.');
        return;
    }

    fetch(BACKEND_URL + '/api/salon/tables', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ name, min_bet, max_players })
    })
    .then(r => r.json())
    .then(data => {
        if (data.msg) { alert(data.msg); return; }
        document.getElementById('new-table-name').value = '';
    })
    .catch(() => alert('Erreur réseau.'));
}

// =====================================================
// UTILITAIRES
// =====================================================

function setStatus(connected) {
    const el = document.getElementById('connection-status');
    el.className = connected ? 'connected' : 'disconnected';
    el.innerText  = connected ? 'Connecté' : 'Déconnecté';
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    socket.disconnect();
    window.location.replace('index.html');
}
