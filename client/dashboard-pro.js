// =====================================================
// FAP FAP Pro — Dashboard Administration
// Sprint 7 : notifications temps réel + recharges
// =====================================================

if (!AuthGuard.require(['superadmin', 'katika'])) throw 0;

const user  = AuthGuard.getUser();
const token = AuthGuard.getToken();

document.getElementById('adminDisplay').innerText =
    `${user.username} (${user.role === 'superadmin' ? 'SuperAdmin' : 'Katika'})`;

// ── Socket.IO ─────────────────────────────────────
const socket = io(BACKEND_URL);

socket.on('connect', () => {
    socket.emit('authenticate', token);
});

socket.on('authenticated', () => {
    // Socket authentifiée : charger le badge initial
    loadUnreadCount();
});

// ── Notifications temps réel ──────────────────────
let unreadCount = 0;

socket.on('notification:new', (notif) => {
    unreadCount++;
    updateBadge(unreadCount);
    prependNotification(notif, true);
    // Recharger les recharges pending si c'est une demande de jetons
    if (notif.type === 'demande_jetons') loadRecharges();
});

socket.on('notification:badge', ({ delta }) => {
    unreadCount = Math.max(0, unreadCount + delta);
    updateBadge(unreadCount);
});

// ── Init ──────────────────────────────────────────
initAdmin();

async function initAdmin() {
    loadKatikaList();
    loadRecharges();
    loadNotifications();
}

// =====================================================
// BADGE + PANNEAU NOTIFICATIONS
// =====================================================

function updateBadge(count) {
    const badge = document.getElementById('notif-badge');
    badge.textContent = count > 99 ? '99+' : count;
    badge.classList.toggle('visible', count > 0);
}

function toggleNotifPanel() {
    const panel   = document.getElementById('notif-panel');
    const overlay = document.getElementById('notif-overlay');
    const isOpen  = panel.classList.contains('open');
    if (isOpen) {
        closeNotifPanel();
    } else {
        panel.classList.add('open');
        overlay.classList.add('open');
    }
}

function closeNotifPanel() {
    document.getElementById('notif-panel').classList.remove('open');
    document.getElementById('notif-overlay').classList.remove('open');
}

async function loadUnreadCount() {
    try {
        const r = await apiFetch('/api/notifications/unread-count');
        if (!r.ok) return;
        const { unread_count } = await r.json();
        unreadCount = unread_count || 0;
        updateBadge(unreadCount);
    } catch { /* silencieux */ }
}

async function loadNotifications() {
    try {
        const r = await apiFetch('/api/notifications?limit=50');
        if (!r.ok) return;
        const { notifications, unread_count } = await r.json();
        unreadCount = unread_count || 0;
        updateBadge(unreadCount);
        renderNotifications(notifications);
    } catch { /* silencieux */ }
}

function renderNotifications(list) {
    const container = document.getElementById('notif-list');
    if (!list || list.length === 0) {
        container.innerHTML = '<div id="notif-empty">Aucune notification</div>';
        return;
    }
    container.innerHTML = list.map(n => buildNotifHTML(n)).join('');
}

function prependNotification(notif, isNew = false) {
    const container = document.getElementById('notif-list');
    const empty = document.getElementById('notif-empty');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.innerHTML = buildNotifHTML({ ...notif, is_read: !isNew });
    container.insertBefore(div.firstChild, container.firstChild);
}

const NOTIF_ICONS = {
    nouvelle_inscription: '👤',
    demande_jetons:       '💰',
    recharge_validee:     '✅',
    recharge_rejetee:     '❌',
    suspension:           '🔴',
    creation_table:       '🎰',
    fermeture_table:      '🚫'
};

function buildNotifHTML(n) {
    const icon     = NOTIF_ICONS[n.type] || '🔔';
    const readClass = n.is_read ? 'read' : 'unread';
    const timeAgo  = relativeTime(n.created_at);
    const actor    = n.actor_username ? `<strong>${n.actor_username}</strong> — ` : '';
    return `
        <div class="notif-item ${readClass}" onclick="markRead(${n.id}, this)">
            <div class="notif-item-title"><span class="notif-icon">${icon}</span>${n.title}</div>
            <div class="notif-item-body">${actor}${n.body || ''}</div>
            <div class="notif-item-time">${timeAgo}</div>
        </div>`;
}

async function markRead(id, el) {
    if (el.classList.contains('read')) return;
    el.classList.replace('unread', 'read');
    unreadCount = Math.max(0, unreadCount - 1);
    updateBadge(unreadCount);
    try { await apiFetch(`/api/notifications/${id}/read`, 'PUT'); } catch { /* silencieux */ }
}

async function markAllRead() {
    try {
        await apiFetch('/api/notifications/read-all', 'PUT');
        document.querySelectorAll('.notif-item.unread').forEach(el => el.classList.replace('unread', 'read'));
        unreadCount = 0;
        updateBadge(0);
    } catch { /* silencieux */ }
}

// =====================================================
// RECHARGES EN ATTENTE
// =====================================================

async function loadRecharges() {
    const tbody  = document.getElementById('rechargesBody');
    const cntBadge = document.getElementById('recharges-count');
    try {
        const r = await apiFetch('/api/money/recharges?status=pending');
        if (!r.ok) return;
        const list = await r.json();

        cntBadge.textContent = list.length;
        cntBadge.classList.toggle('visible', list.length > 0);

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#555;padding:20px;">Aucune demande en attente</td></tr>`;
            return;
        }

        tbody.innerHTML = list.map(rq => `
            <tr class="recharge-row">
                <td><strong>${rq.target_name}</strong></td>
                <td style="color:#888;font-size:0.8rem;">${rq.requester_name}</td>
                <td><span class="recharge-amount">${parseFloat(rq.amount).toLocaleString()} FCFA</span></td>
                <td style="color:#888;font-size:0.78rem;">${rq.note || '—'}</td>
                <td style="color:#666;font-size:0.75rem;">${new Date(rq.created_at).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
                <td>
                    <button class="btn-approve" onclick="approveRecharge(${rq.id})">✓ Valider</button>
                    <button class="btn-reject"  onclick="rejectRecharge(${rq.id})">✕ Refuser</button>
                </td>
            </tr>`).join('');
    } catch {
        tbody.innerHTML = `<tr><td colspan="6" style="color:#e74c3c;text-align:center;">Erreur chargement.</td></tr>`;
    }
}

async function approveRecharge(id) {
    if (!confirm('Valider cette demande de recharge ?')) return;
    try {
        const r = await apiFetch(`/api/money/recharges/${id}/approve`, 'PUT');
        const data = await r.json();
        if (r.ok) {
            showToast(`✅ ${data.msg}`);
            loadRecharges();
        } else {
            showToast(data.msg || 'Erreur.', true);
        }
    } catch { showToast('Erreur réseau.', true); }
}

async function rejectRecharge(id) {
    const note = prompt('Motif du refus (optionnel) :') ?? '';
    try {
        const r = await apiFetch(`/api/money/recharges/${id}/reject`, 'PUT', { note });
        const data = await r.json();
        if (r.ok) {
            showToast('Demande refusée.');
            loadRecharges();
        } else {
            showToast(data.msg || 'Erreur.', true);
        }
    } catch { showToast('Erreur réseau.', true); }
}

// =====================================================
// RECRUTEMENT KATIKA
// =====================================================

document.getElementById('addKatikaFormPro').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
        username: document.getElementById('k_name').value,
        phone:    document.getElementById('k_phone').value,
        password: document.getElementById('k_pass').value,
        clubName: document.getElementById('k_club').value
    };
    try {
        const r = await apiFetch('/api/auth/register-katika', 'POST', data);
        const result = await r.json();
        if (r.ok) {
            showToast(result.msg);
            document.getElementById('addKatikaFormPro').reset();
            loadKatikaList();
        } else {
            showToast(result.msg || 'Erreur.', true);
        }
    } catch { showToast('Erreur réseau.', true); }
});

async function loadKatikaList() {
    const tbody = document.getElementById('katikaTableBody');
    try {
        const r = await apiFetch('/api/money/all-katikas');
        const katikas = await r.json();

        if (!katikas || katikas.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#555;padding:20px;">Aucun Katika recruté.</td></tr>`;
            return;
        }

        tbody.innerHTML = katikas.map(k => `
            <tr>
                <td><div style="font-weight:bold;">${k.username}</div><div style="font-size:0.72rem;color:#666;">📞 ${k.phone}</div></td>
                <td><span class="badge-katika">${k.club_name || 'Sans Club'}</span></td>
                <td style="color:var(--pro-gold);font-weight:bold;">${parseFloat(k.wallet).toLocaleString()} FCFA</td>
                <td><span style="color:#4caf50;font-size:0.78rem;">● ACTIF</span></td>
                <td>
                    <button onclick="rechargeKatika(${k.id}, '${k.username}')" style="background:#222;border:1px solid var(--pro-gold);color:var(--pro-gold);padding:5px 10px;border-radius:4px;cursor:pointer;font-size:0.72rem;">💰 DOTER</button>
                </td>
            </tr>`).join('');

        document.getElementById('statClubs').innerText = katikas.length;
    } catch {
        tbody.innerHTML = `<tr><td colspan="5" style="color:red;text-align:center;">Erreur chargement.</td></tr>`;
    }
}

function rechargeKatika(id, name) {
    const amount = prompt(`Dotation pour ${name} (FCFA) :`);
    if (amount && !isNaN(amount) && parseInt(amount) > 0) transferToKatika(id, parseInt(amount));
}

async function transferToKatika(id, amount) {
    try {
        const r = await apiFetch('/api/money/transfer', 'POST', { receiver_id: id, amount });
        if (r.ok) { showToast('Dotation effectuée !'); loadKatikaList(); }
        else       { showToast('Échec du transfert.', true); }
    } catch { showToast('Erreur serveur.', true); }
}

// =====================================================
// UTILITAIRES
// =====================================================

function apiFetch(path, method = 'GET', body = null) {
    const opts = {
        method,
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
    };
    if (body) opts.body = JSON.stringify(body);
    return fetch(BACKEND_URL + path, opts);
}

function relativeTime(dateStr) {
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
    if (diff < 60)   return 'à l\'instant';
    if (diff < 3600) return `il y a ${Math.floor(diff/60)} min`;
    if (diff < 86400)return `il y a ${Math.floor(diff/3600)} h`;
    return new Date(dateStr).toLocaleDateString('fr-FR');
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
    AuthGuard.logout();
}
