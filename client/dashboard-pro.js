// =====================================================
// FAP FAP Pro — Dashboard Administration
// =====================================================

if (!AuthGuard.require(['superadmin', 'katika'])) throw 0;

const user  = AuthGuard.getUser();
const token = AuthGuard.getToken();

document.getElementById('adminDisplay').innerText =
    `${user.username} (${user.role === 'superadmin' ? 'SuperAdmin' : 'Katika'})`;

// ── Socket.IO ─────────────────────────────────────
const socket = io(BACKEND_URL);

socket.on('connect', () => socket.emit('authenticate', token));

socket.on('authenticated', () => loadUnreadCount());

socket.on('notification:new', (notif) => {
    unreadCount++;
    updateBadge(unreadCount);
    prependNotification(notif, true);
    if (notif.type === 'demande_jetons')  loadRecharges();
    if (notif.type === 'demande_retrait') loadWithdrawals();
});

socket.on('notification:badge', ({ delta }) => {
    unreadCount = Math.max(0, unreadCount + delta);
    updateBadge(unreadCount);
});

socket.on('visitor:stats', (s) => {
    const onlineEl = document.getElementById('statOnline');
    const tabEl    = document.getElementById('statTablesLive');
    if (onlineEl) onlineEl.textContent = s.total_connected ?? '—';
    if (tabEl)    tabEl.textContent    = s.active_tables   ?? '—';
});

// ── Init ──────────────────────────────────────────
initAdmin();

async function initAdmin() {
    loadWithdrawals();
    loadRecharges();
    loadNotifications();
    loadDbStats();
    loadKatikaList();
    if (user.role === 'superadmin') {
        loadClubs();
        loadUsers();
    }
    loadAnnouncements();
}

// =====================================================
// ONGLETS
// =====================================================

function showTab(name) {
    document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + name)?.classList.add('active');
    document.querySelectorAll('.tab-btn').forEach(b => {
        if (b.getAttribute('onclick')?.includes(`'${name}'`)) b.classList.add('active');
    });
    // Chargement à la demande pour Transactions (lourd)
    if (name === 'transactions' && !window._txLoaded) {
        window._txLoaded = true;
        loadTransactions();
    }
}

// =====================================================
// BADGE + PANNEAU NOTIFICATIONS
// =====================================================

let unreadCount = 0;

function updateBadge(count) {
    const badge = document.getElementById('notif-badge');
    badge.textContent = count > 99 ? '99+' : count;
    badge.classList.toggle('visible', count > 0);
}

function toggleNotifPanel() {
    const panel   = document.getElementById('notif-panel');
    const overlay = document.getElementById('notif-overlay');
    if (panel.classList.contains('open')) { closeNotifPanel(); }
    else { panel.classList.add('open'); overlay.classList.add('open'); }
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
    fermeture_table:      '🚫',
    demande_retrait:      '💸',
    retrait_valide:       '🔵',
    retrait_refuse:       '🚫',
    retrait_paye:         '✅'
};

function buildNotifHTML(n) {
    const icon      = NOTIF_ICONS[n.type] || '🔔';
    const readClass = n.is_read ? 'read' : 'unread';
    const timeAgo   = relativeTime(n.created_at);
    const actor     = n.actor_username ? `<strong>${n.actor_username}</strong> — ` : '';
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
    const tbody    = document.getElementById('rechargesBody');
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
            <tr>
                <td><strong>${rq.target_name}</strong></td>
                <td style="color:#888;font-size:0.8rem;">${rq.requester_name}</td>
                <td><span class="recharge-amount">${parseFloat(rq.amount).toLocaleString('fr-FR')} FCFA</span></td>
                <td style="color:#888;font-size:0.78rem;">${rq.note || '—'}</td>
                <td style="color:#666;font-size:0.75rem;">${fmtDate(rq.created_at)}</td>
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
        const r    = await apiFetch(`/api/money/recharges/${id}/approve`, 'PUT');
        const data = await r.json();
        if (r.ok) { showToast(`✅ ${data.msg}`); loadRecharges(); }
        else        showToast(data.msg || 'Erreur.', true);
    } catch { showToast('Erreur réseau.', true); }
}

async function rejectRecharge(id) {
    const note = prompt('Motif du refus (optionnel) :') ?? '';
    try {
        const r    = await apiFetch(`/api/money/recharges/${id}/reject`, 'PUT', { note });
        const data = await r.json();
        if (r.ok) { showToast('Demande refusée.'); loadRecharges(); }
        else        showToast(data.msg || 'Erreur.', true);
    } catch { showToast('Erreur réseau.', true); }
}

// =====================================================
// RETRAITS WAVE
// =====================================================

const WD_STATUS_LABELS = {
    pending:   '<span class="withdrawal-status ws-pending">En attente</span>',
    validated: '<span class="withdrawal-status ws-validated">Validé</span>',
    rejected:  '<span class="withdrawal-status ws-rejected">Refusé</span>',
    paid:      '<span class="withdrawal-status ws-paid">Payé</span>'
};

async function loadWithdrawals() {
    const tbody    = document.getElementById('withdrawalsBody');
    const cntBadge = document.getElementById('withdrawals-count');
    if (!tbody) return;
    try {
        const r = await apiFetch('/api/money/withdrawals');
        if (!r.ok) return;
        const list = await r.json();

        const pendingCount = list.filter(w => w.status === 'pending').length;
        cntBadge.textContent = pendingCount;
        cntBadge.classList.toggle('visible', pendingCount > 0);

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:#555;padding:20px;">Aucune demande de retrait</td></tr>`;
            return;
        }
        tbody.innerHTML = list.map(w => {
            const amount    = parseFloat(w.amount);
            const netAmount = Math.round(amount * 0.98 * 100) / 100;
            const actions   = w.status === 'pending' ? `
                <button class="btn-wd-validate" onclick="validateWithdrawal(${w.id})">✓ Valider</button>
                <button class="btn-wd-reject"   onclick="rejectWithdrawal(${w.id})">✕ Refuser</button>
            ` : w.status === 'validated' ? `
                <button class="btn-wd-pay"    onclick="payWithdrawal(${w.id}, ${amount}, ${netAmount})">💸 Payer</button>
                <button class="btn-wd-reject" onclick="rejectWithdrawal(${w.id})" style="font-size:0.7rem">Annuler</button>
            ` : `<span style="color:#555;font-size:0.75rem;">—</span>`;

            return `<tr>
                <td style="color:#555;font-size:0.72rem;">#${w.id}</td>
                <td><strong>${w.username}</strong></td>
                <td style="color:#888;font-size:0.78rem;">${w.phone}</td>
                <td style="font-family:monospace;font-size:0.82rem;">${w.wave_number}</td>
                <td style="font-size:0.82rem;">${w.wave_holder}</td>
                <td style="color:var(--pro-gold);font-weight:bold;">${amount.toLocaleString('fr-FR')} FCFA</td>
                <td style="color:#2ecc71;font-weight:bold;">${netAmount.toLocaleString('fr-FR')} FCFA</td>
                <td style="color:#666;font-size:0.75rem;">${fmtDate(w.created_at)}</td>
                <td>${WD_STATUS_LABELS[w.status] || w.status}</td>
                <td style="white-space:nowrap;">${actions}</td>
            </tr>`;
        }).join('');
    } catch {
        tbody.innerHTML = `<tr><td colspan="10" style="color:#e74c3c;text-align:center;">Erreur chargement.</td></tr>`;
    }
}

async function validateWithdrawal(id) {
    if (!confirm('Valider cette demande de retrait ?')) return;
    try {
        const r    = await apiFetch(`/api/money/withdrawals/${id}/validate`, 'PUT');
        const data = await r.json();
        if (r.ok) { showToast('Retrait validé — en attente de paiement.'); loadWithdrawals(); }
        else showToast(data.msg || 'Erreur.', true);
    } catch { showToast('Erreur réseau.', true); }
}

async function rejectWithdrawal(id) {
    const note = prompt('Motif du refus (optionnel) :') ?? '';
    if (note === null) return;
    try {
        const r    = await apiFetch(`/api/money/withdrawals/${id}/reject`, 'PUT', { note });
        const data = await r.json();
        if (r.ok) { showToast('Retrait refusé.'); loadWithdrawals(); }
        else showToast(data.msg || 'Erreur.', true);
    } catch { showToast('Erreur réseau.', true); }
}

async function payWithdrawal(id, amount, netAmount) {
    const msg = netAmount
        ? `Confirmer le paiement ?\n\nMontant demandé : ${amount.toLocaleString('fr-FR')} FCFA\nFrais plateforme (2%) : ${Math.round(amount * 0.02).toLocaleString('fr-FR')} FCFA\n→ Vous devez envoyer ${netAmount.toLocaleString('fr-FR')} FCFA via Wave`
        : 'Confirmer le paiement via Wave ?';
    if (!confirm(msg)) return;
    try {
        const r    = await apiFetch(`/api/money/withdrawals/${id}/pay`, 'PUT');
        const data = await r.json();
        if (r.ok) { showToast(`✅ ${data.msg}`); loadWithdrawals(); }
        else showToast(data.msg || 'Erreur.', true);
    } catch { showToast('Erreur réseau.', true); }
}

// =====================================================
// JOUEURS — liste complète
// =====================================================

let _allUsers = [];

async function loadUsers() {
    const tbody = document.getElementById('usersBody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#555;padding:20px;">Chargement…</td></tr>`;
    try {
        const r = await apiFetch('/api/admin/users');
        if (!r.ok) return;
        _allUsers = await r.json();
        const cntEl = document.getElementById('users-count');
        if (cntEl) cntEl.textContent = _allUsers.length;
        renderUsers(_allUsers);
    } catch {
        tbody.innerHTML = `<tr><td colspan="9" style="color:#e74c3c;text-align:center;">Erreur chargement.</td></tr>`;
    }
}

function filterUsers() {
    const search = document.getElementById('usr-search')?.value.toLowerCase() || '';
    const role   = document.getElementById('usr-role')?.value   || '';
    const status = document.getElementById('usr-status')?.value || '';
    const filtered = _allUsers.filter(u =>
        (!search || u.username.toLowerCase().includes(search) || u.phone.includes(search)) &&
        (!role   || u.role   === role)   &&
        (!status || u.status === status)
    );
    renderUsers(filtered);
}

const STATUS_BADGE = {
    active:    '<span class="badge-active">● Actif</span>',
    suspended: '<span class="badge-suspended">⏸ Suspendu</span>',
    inactive:  '<span class="badge-inactive">✕ Banni</span>'
};
const ROLE_BADGE = {
    player:     '',
    katika:     '<span class="badge-katika">Katika</span>',
    superadmin: '<span class="badge-superadmin">SuperAdmin</span>'
};

function renderUsers(list) {
    const tbody = document.getElementById('usersBody');
    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#555;padding:20px;">Aucun utilisateur trouvé.</td></tr>`;
        return;
    }
    tbody.innerHTML = list.map(u => {
        const isSelf  = u.id === user.id;
        const canAct  = !isSelf && u.role !== 'superadmin';
        const lastCo  = u.last_login ? relativeTime(u.last_login) : '—';

        const suspendBtn = (u.status === 'active' && canAct)
            ? `<button class="btn-sm btn-suspend"   onclick="doSuspend(${u.id}, '${escHtml(u.username)}')">Suspendre</button>` : '';
        const unsuspendBtn = (u.status === 'suspended' && canAct)
            ? `<button class="btn-sm btn-unsuspend" onclick="doUnsuspend(${u.id}, '${escHtml(u.username)}')">Réactiver</button>` : '';
        const banBtn = (u.status !== 'inactive' && canAct && user.role === 'superadmin')
            ? `<button class="btn-sm btn-ban"       onclick="doBan(${u.id}, '${escHtml(u.username)}')">Bannir</button>` : '';
        const walletBtn = (user.role === 'superadmin')
            ? `<button class="btn-sm btn-wallet"    onclick="doAdjustWallet(${u.id}, '${escHtml(u.username)}', ${u.wallet})">💰 Solde</button>` : '';

        return `<tr>
            <td style="color:#555;font-size:0.72rem;">${u.id}</td>
            <td><strong>${escHtml(u.username)}</strong>${isSelf ? ' <span style="color:#888;font-size:0.7rem;">(vous)</span>' : ''}</td>
            <td style="color:#888;font-size:0.78rem;">${u.phone}</td>
            <td>${ROLE_BADGE[u.role] || u.role}</td>
            <td style="font-size:0.78rem;color:#aaa;">${u.club_name || '—'}</td>
            <td style="color:var(--pro-gold);font-weight:bold;">${u.wallet.toLocaleString('fr-FR')} FCFA</td>
            <td>${STATUS_BADGE[u.status] || u.status}</td>
            <td style="color:#555;font-size:0.75rem;">${lastCo}</td>
            <td style="white-space:nowrap;display:flex;gap:4px;flex-wrap:wrap;">
                ${suspendBtn}${unsuspendBtn}${banBtn}${walletBtn}
            </td>
        </tr>`;
    }).join('');
}

async function doSuspend(id, name) {
    const reason = prompt(`Motif de suspension de ${name} (optionnel) :`) ?? '';
    if (reason === null) return;
    try {
        const r    = await apiFetch(`/api/admin/users/${id}/suspend`, 'PUT', { reason });
        const data = await r.json();
        if (r.ok) { showToast(data.msg); loadUsers(); }
        else showToast(data.msg || 'Erreur.', true);
    } catch { showToast('Erreur réseau.', true); }
}

async function doUnsuspend(id, name) {
    if (!confirm(`Réactiver le compte de ${name} ?`)) return;
    try {
        const r    = await apiFetch(`/api/admin/users/${id}/unsuspend`, 'PUT');
        const data = await r.json();
        if (r.ok) { showToast(data.msg); loadUsers(); }
        else showToast(data.msg || 'Erreur.', true);
    } catch { showToast('Erreur réseau.', true); }
}

async function doBan(id, name) {
    const reason = prompt(`⚠️ BANNISSEMENT DÉFINITIF de ${name}.\nMotif (requis) :`);
    if (!reason?.trim()) { showToast('Motif requis pour bannir.', true); return; }
    if (!confirm(`Bannir définitivement ${name} ? Cette action est irréversible.`)) return;
    try {
        const r    = await apiFetch(`/api/admin/users/${id}/ban`, 'PUT', { reason });
        const data = await r.json();
        if (r.ok) { showToast(data.msg); loadUsers(); }
        else showToast(data.msg || 'Erreur.', true);
    } catch { showToast('Erreur réseau.', true); }
}

async function doAdjustWallet(id, name, currentWallet) {
    const input = prompt(`Ajustement du solde de ${name}\nSolde actuel : ${currentWallet.toLocaleString('fr-FR')} FCFA\n\nMontant (+ pour crédit, - pour débit) :`)?.trim();
    if (!input || input === null) return;
    const amount = parseFloat(input);
    if (isNaN(amount) || amount === 0) { showToast('Montant invalide.', true); return; }
    const note = prompt(`Note pour l'audit (optionnel) :`)?.trim() || '';
    try {
        const r    = await apiFetch(`/api/admin/users/${id}/wallet`, 'PUT', { amount, note });
        const data = await r.json();
        if (r.ok) { showToast(data.msg); loadUsers(); }
        else showToast(data.msg || 'Erreur.', true);
    } catch { showToast('Erreur réseau.', true); }
}

// =====================================================
// TRANSACTIONS — historique
// =====================================================

let _allTx = [];

async function loadTransactions() {
    const tbody  = document.getElementById('txBody');
    const cntEl  = document.getElementById('tx-count');
    const type   = document.getElementById('tx-type')?.value || '';
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#555;padding:20px;">Chargement…</td></tr>`;
    try {
        const qs   = type ? `?type=${encodeURIComponent(type)}&limit=300` : '?limit=300';
        const r    = await apiFetch('/api/admin/transactions' + qs);
        if (!r.ok) return;
        _allTx = await r.json();
        if (cntEl) cntEl.textContent = `${_allTx.length} transaction(s)`;
        filterTransactions();
    } catch {
        tbody.innerHTML = `<tr><td colspan="9" style="color:#e74c3c;text-align:center;">Erreur chargement.</td></tr>`;
    }
}

function filterTransactions() {
    const search = document.getElementById('tx-search')?.value.toLowerCase() || '';
    const list   = search
        ? _allTx.filter(t =>
            t.username.toLowerCase().includes(search) ||
            (t.note || '').toLowerCase().includes(search)
          )
        : _allTx;
    renderTransactions(list);
}

const TX_TYPE_LABELS = {
    mise:       '<span class="tx-mise">Mise</span>',
    commission: '<span class="tx-commission">Commission</span>',
    transfert:  '<span class="tx-transfert">Transfert</span>',
    recharge:   '<span class="tx-recharge">Recharge</span>'
};

function renderTransactions(list) {
    const tbody = document.getElementById('txBody');
    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#555;padding:20px;">Aucune transaction.</td></tr>`;
        return;
    }
    tbody.innerHTML = list.map(t => {
        const amt    = parseFloat(t.amount);
        const color  = amt >= 0 ? '#2ecc71' : '#e74c3c';
        const sign   = amt >= 0 ? '+' : '';
        return `<tr>
            <td style="color:#555;font-size:0.72rem;">${t.id}</td>
            <td><strong>${escHtml(t.username)}</strong></td>
            <td style="color:#888;font-size:0.75rem;">${t.phone}</td>
            <td>${TX_TYPE_LABELS[t.type] || t.type}</td>
            <td style="color:${color};font-weight:bold;">${sign}${Math.abs(amt).toLocaleString('fr-FR')} FCFA</td>
            <td style="color:#666;font-size:0.75rem;">${parseFloat(t.balance_before || 0).toLocaleString('fr-FR')}</td>
            <td style="color:#aaa;font-size:0.75rem;">${parseFloat(t.balance_after || 0).toLocaleString('fr-FR')}</td>
            <td style="color:#666;font-size:0.75rem;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(t.note || '')}">${escHtml(t.note || '—')}</td>
            <td style="color:#555;font-size:0.75rem;">${fmtDate(t.created_at)}</td>
        </tr>`;
    }).join('');
}

// =====================================================
// CLUBS
// =====================================================

async function loadClubs() {
    const tbody = document.getElementById('clubsBody');
    if (!tbody) return;
    try {
        const r = await apiFetch('/api/admin/clubs');
        if (!r.ok) return;
        const list = await r.json();

        if (!list.length) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#555;padding:20px;">Aucun club.</td></tr>`;
            return;
        }
        tbody.innerHTML = list.map(c => `
            <tr>
                <td style="color:#555;font-size:0.72rem;">${c.id}</td>
                <td><strong>${escHtml(c.name)}</strong></td>
                <td>${c.katika_name ? escHtml(c.katika_name) : '<span style="color:#555">—</span>'}</td>
                <td style="color:#888;font-size:0.78rem;">${c.katika_phone || '—'}</td>
                <td style="color:#2ecc71;font-weight:bold;">${c.active_players}</td>
                <td style="color:#aaa;">${c.total_players}</td>
                <td style="color:var(--pro-gold);">${parseFloat(c.total_volume).toLocaleString('fr-FR')} FCFA</td>
                <td style="color:var(--pro-gold);font-weight:bold;">${c.katika_wallet.toLocaleString('fr-FR')} FCFA</td>
                <td>
                    ${c.katika_id ? `<button class="btn-sm btn-doter" onclick="rechargeKatika(${c.katika_id}, '${escHtml(c.katika_name)}')">💰 Doter</button>` : '—'}
                </td>
            </tr>`).join('');

        const statClubs = document.getElementById('statClubs');
        if (statClubs) statClubs.textContent = list.length;
    } catch {
        if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="color:#e74c3c;text-align:center;">Erreur chargement.</td></tr>`;
    }
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
        const r      = await apiFetch('/api/auth/register-katika', 'POST', data);
        const result = await r.json();
        if (r.ok) {
            showToast(result.msg);
            document.getElementById('addKatikaFormPro').reset();
            loadKatikaList();
            loadClubs();
        } else {
            showToast(result.msg || 'Erreur.', true);
        }
    } catch { showToast('Erreur réseau.', true); }
});

async function loadKatikaList() {
    const tbody = document.getElementById('katikaTableBody');
    if (!tbody) return;
    try {
        const r      = await apiFetch('/api/money/all-katikas');
        const katikas = await r.json();

        if (!katikas || katikas.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#555;padding:20px;">Aucun Katika recruté.</td></tr>`;
            return;
        }
        tbody.innerHTML = katikas.map(k => `
            <tr>
                <td><div style="font-weight:bold;">${escHtml(k.username)}</div><div style="font-size:0.72rem;color:#666;">📞 ${k.phone}</div></td>
                <td><span class="badge-katika">${escHtml(k.club_name || 'Sans Club')}</span></td>
                <td style="color:var(--pro-gold);font-weight:bold;">${parseFloat(k.wallet).toLocaleString('fr-FR')} FCFA</td>
                <td><span style="color:#4caf50;font-size:0.78rem;">● ACTIF</span></td>
                <td>
                    <button class="btn-sm btn-doter" onclick="rechargeKatika(${k.id}, '${escHtml(k.username)}')">💰 DOTER</button>
                </td>
            </tr>`).join('');

        const statClubs = document.getElementById('statClubs');
        if (statClubs && !document.getElementById('clubsBody')?.children.length) {
            statClubs.textContent = katikas.length;
        }
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
        if (r.ok) { showToast('Dotation effectuée !'); loadKatikaList(); loadClubs(); }
        else       showToast('Échec du transfert.', true);
    } catch { showToast('Erreur serveur.', true); }
}

// =====================================================
// STATS DB
// =====================================================

async function loadDbStats() {
    if (user.role !== 'superadmin') return;
    try {
        const r = await apiFetch('/api/admin/stats');
        if (!r.ok) return;
        const s = await r.json();
        const vol  = document.getElementById('statVolume');
        const com  = document.getElementById('statComms');
        const acad = document.getElementById('statAcademy');
        if (vol)  vol.textContent  = Math.round(s.total_volume       || 0).toLocaleString('fr-FR') + ' F';
        if (com)  com.textContent  = Math.round(s.total_commissions  || 0).toLocaleString('fr-FR') + ' F';
        if (acad) acad.textContent = s.academy_players ?? '—';
    } catch { /* silencieux */ }
}

// =====================================================
// ANNONCES CRUD
// =====================================================

const ANN_META = {
    INFO:        { icon: 'ℹ️',  color: '#3498db' },
    TOURNAMENT:  { icon: '🏆',  color: '#e67e22' },
    PROMOTION:   { icon: '🎁',  color: '#2ecc71' },
    MAINTENANCE: { icon: '⚠️',  color: '#e74c3c' },
    UPDATE:      { icon: '🆕',  color: '#9b59b6' },
    WARNING:     { icon: '🚨',  color: '#f39c12' }
};

async function loadAnnouncements() {
    const container = document.getElementById('ann-list');
    try {
        const r = await apiFetch('/api/announcements/admin');
        if (!r.ok) return;
        const { announcements } = await r.json();
        renderAnnList(announcements);
    } catch {
        if (container) container.innerHTML = '<p style="color:#e74c3c;text-align:center;">Erreur chargement.</p>';
    }
}

function renderAnnList(anns) {
    const container = document.getElementById('ann-list');
    if (!container) return;
    if (!anns || anns.length === 0) {
        container.innerHTML = '<p style="color:#555;text-align:center;padding:20px 0;">Aucune annonce publiée.</p>';
        return;
    }
    container.innerHTML = anns.map(ann => {
        const meta = ANN_META[ann.announcement_type] || ANN_META.INFO;
        return `
        <div class="ann-row${ann.is_active ? '' : ' inactive'}" style="border-left:3px solid ${meta.color}">
            <div class="ann-row-top">
                <div>
                    <div class="ann-row-title" style="color:${meta.color}">${meta.icon} ${escHtml(ann.title)}${ann.pinned ? ' <span style="font-size:0.7rem;background:#333;padding:2px 6px;border-radius:4px;">📌</span>' : ''}</div>
                    <div class="ann-row-meta">${ann.announcement_type} · ${ann.target_audience} · ${new Date(ann.created_at).toLocaleDateString('fr-FR')}</div>
                    <div class="ann-row-body">${escHtml(ann.body.length > 90 ? ann.body.substring(0, 90) + '…' : ann.body)}</div>
                </div>
                <div class="ann-row-actions">
                    <button class="ann-btn ${ann.is_active ? 'ann-btn-active' : 'ann-btn-inactive'}" onclick="toggleAnn(${ann.id}, 'is_active', ${!ann.is_active})">${ann.is_active ? '● Actif' : '○ Inactif'}</button>
                    <button class="ann-btn ${ann.pinned ? 'ann-btn-pin' : 'ann-btn-nopin'}" onclick="toggleAnn(${ann.id}, 'pinned', ${!ann.pinned})">${ann.pinned ? '📌 Épinglé' : '📌 Épingler'}</button>
                    <button class="ann-btn ann-btn-del" onclick="deleteAnn(${ann.id})">✕</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

document.getElementById('ann-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('ann-error');
    errEl.textContent = '';
    const payload = {
        announcement_type: document.getElementById('ann-type').value,
        title:             document.getElementById('ann-title').value.trim(),
        body:              document.getElementById('ann-body').value.trim(),
        channel_whatsapp:  document.getElementById('ann-wa').value.trim() || null,
        channel_telegram:  document.getElementById('ann-tg').value.trim() || null,
        channel_discord:   document.getElementById('ann-dc').value.trim() || null,
        pinned:            document.getElementById('ann-pinned').checked,
        target_audience:   document.getElementById('ann-audience').value
    };
    if (!payload.title || !payload.body) { errEl.textContent = 'Titre et message sont requis.'; return; }
    try {
        const r    = await apiFetch('/api/announcements', 'POST', payload);
        const data = await r.json();
        if (!r.ok) { errEl.textContent = data.msg || 'Erreur.'; return; }
        document.getElementById('ann-form').reset();
        showToast('Annonce publiée !');
        loadAnnouncements();
    } catch { errEl.textContent = 'Erreur réseau.'; }
});

async function toggleAnn(id, field, value) {
    try {
        const r = await apiFetch(`/api/announcements/${id}`, 'PUT', { [field]: value });
        if (r.ok) loadAnnouncements();
        else { const d = await r.json(); showToast(d.msg || 'Erreur.', true); }
    } catch { showToast('Erreur réseau.', true); }
}

async function deleteAnn(id) {
    if (!confirm('Supprimer cette annonce ?')) return;
    try {
        const r = await apiFetch(`/api/announcements/${id}`, 'DELETE');
        if (r.ok) { showToast('Annonce supprimée.'); loadAnnouncements(); }
        else { const d = await r.json(); showToast(d.msg || 'Erreur.', true); }
    } catch { showToast('Erreur réseau.', true); }
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
    if (diff < 60)    return 'à l\'instant';
    if (diff < 3600)  return `il y a ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
    return new Date(dateStr).toLocaleDateString('fr-FR');
}

function fmtDate(dateStr) {
    return new Date(dateStr).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function escHtml(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg, isError = false) {
    const t = document.getElementById('toast');
    t.textContent    = msg;
    t.className      = isError ? 'error' : '';
    t.style.display  = 'block';
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => { t.style.display = 'none'; }, 4000);
}

function logout() {
    socket.disconnect();
    AuthGuard.logout();
}
