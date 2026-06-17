// =============================================================
// FAP FAP — Changement de rôle dynamique (sans logout)
// Composant autonome : s'injecte dans toute page via <script>
// =============================================================
(function () {
    const user = JSON.parse(localStorage.getItem('user'));
    if (!user) return;

    // ----------------------------------------------------------------
    // Configuration des modes — ordre d'affichage dans la modale
    // ----------------------------------------------------------------
    const MODES = [
        {
            key: 'player',
            icon: '🎮',
            label: 'Mode Joueur',
            desc: 'Salon de jeu — Tables en temps réel',
            url: 'salon.html',
            roles: ['player', 'katika', 'superadmin']
        },
        {
            key: 'katika',
            icon: '🎖️',
            label: 'Mode Katika',
            desc: 'Espace Katika — Gestion de club',
            url: 'club-manage.html',
            roles: ['katika', 'superadmin']
        },
        {
            key: 'admin',
            icon: '👑',
            label: 'Mode Admin',
            desc: 'Tableau de bord — Vue globale',
            url: 'dashboard-pro.html',
            roles: ['superadmin']
        }
    ];

    // Modes que ce joueur peut utiliser (selon son rôle JWT réel)
    const available = MODES.filter(m => m.roles.includes(user.role));
    if (available.length <= 1) return; // Joueur standard : rien à faire

    // Mode actif déduit de la page courante
    const page = window.location.pathname.split('/').pop() || 'index.html';
    const active = MODES.find(m => m.url === page) || available[0];
    localStorage.setItem('active_mode', active.key);

    // ----------------------------------------------------------------
    // Styles
    // ----------------------------------------------------------------
    const style = document.createElement('style');
    style.textContent = `
        /* Bouton flottant */
        #rs-fab {
            position: fixed;
            bottom: 24px;
            right: 70px;
            background: #111;
            border: 1.5px solid #d4af37;
            color: #d4af37;
            border-radius: 50px;
            padding: 9px 18px;
            font-size: 0.8rem;
            font-weight: 700;
            cursor: pointer;
            z-index: 900;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 2px 12px rgba(0,0,0,0.5);
            transition: background 0.2s, box-shadow 0.2s, transform 0.15s;
            letter-spacing: 0.4px;
        }
        #rs-fab:hover {
            background: #1e1e1e;
            box-shadow: 0 4px 18px rgba(212,175,55,0.35);
            transform: translateY(-1px);
        }
        #rs-fab .rs-fab-icon { font-size: 1rem; }

        /* Badge rôle actif (injecté dans la navbar) */
        .rs-badge {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            background: rgba(212,175,55,0.13);
            border: 1px solid rgba(212,175,55,0.4);
            color: #d4af37;
            font-size: 0.71rem;
            font-weight: 700;
            padding: 4px 10px;
            border-radius: 12px;
            letter-spacing: 0.4px;
            cursor: pointer;
            transition: background 0.15s;
        }
        .rs-badge:hover { background: rgba(212,175,55,0.25); }

        /* Overlay */
        #rs-overlay {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.75);
            z-index: 1200;
            align-items: center;
            justify-content: center;
        }
        #rs-overlay.open { display: flex; }

        /* Boîte modale */
        #rs-modal {
            background: #141414;
            border: 1px solid #d4af37;
            border-radius: 16px;
            padding: 28px 28px 24px;
            width: 360px;
            max-width: 92vw;
            animation: rsPopIn 0.2s cubic-bezier(0.34,1.56,0.64,1);
        }
        @keyframes rsPopIn {
            from { opacity: 0; transform: scale(0.88) translateY(14px); }
            to   { opacity: 1; transform: scale(1)    translateY(0);    }
        }
        #rs-modal h2 {
            color: #d4af37;
            margin: 0 0 6px;
            font-size: 1rem;
            text-align: center;
            letter-spacing: 1.5px;
            text-transform: uppercase;
        }
        #rs-modal .rs-sub {
            text-align: center;
            color: #555;
            font-size: 0.75rem;
            margin-bottom: 20px;
        }

        /* Options */
        .rs-opt {
            display: flex;
            align-items: center;
            gap: 13px;
            padding: 13px 14px;
            border-radius: 9px;
            border: 1.5px solid transparent;
            margin-bottom: 8px;
            cursor: pointer;
            transition: border-color 0.15s, background 0.15s;
            color: #bbb;
            font-size: 0.88rem;
            user-select: none;
        }
        .rs-opt:last-child { margin-bottom: 0; }
        .rs-opt:not(.rs-opt-current):hover {
            background: #1e1e1e;
            border-color: #333;
            color: #fff;
        }
        .rs-opt.rs-opt-selected {
            border-color: #d4af37;
            background: rgba(212,175,55,0.1);
            color: #fff;
        }
        .rs-opt.rs-opt-current {
            opacity: 0.45;
            cursor: default;
        }
        .rs-opt .rs-opt-icon { font-size: 1.25rem; width: 30px; text-align: center; flex-shrink: 0; }
        .rs-opt .rs-opt-text { flex: 1; }
        .rs-opt .rs-opt-label { font-weight: 700; line-height: 1.2; }
        .rs-opt .rs-opt-desc { font-size: 0.71rem; color: #555; margin-top: 3px; }
        .rs-opt .rs-opt-current-tag {
            font-size: 0.62rem;
            background: #2a2a2a;
            color: #666;
            padding: 2px 7px;
            border-radius: 8px;
            white-space: nowrap;
            flex-shrink: 0;
        }
        /* Radio visuel */
        .rs-opt .rs-radio {
            width: 17px;
            height: 17px;
            border-radius: 50%;
            border: 2px solid #444;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: border-color 0.15s;
        }
        .rs-opt.rs-opt-selected .rs-radio {
            border-color: #d4af37;
        }
        .rs-opt.rs-opt-selected .rs-radio::after {
            content: '';
            width: 9px;
            height: 9px;
            background: #d4af37;
            border-radius: 50%;
        }

        /* Boutons d'action */
        .rs-actions {
            display: flex;
            gap: 10px;
            margin-top: 22px;
        }
        .rs-btn-cancel {
            flex: 1;
            background: transparent;
            border: 1px solid #333;
            color: #777;
            border-radius: 8px;
            padding: 11px;
            cursor: pointer;
            font-size: 0.85rem;
            transition: border-color 0.2s, color 0.2s;
        }
        .rs-btn-cancel:hover { border-color: #555; color: #ccc; }
        .rs-btn-switch {
            flex: 2;
            background: #d4af37;
            border: none;
            color: #000;
            border-radius: 8px;
            padding: 11px;
            font-weight: 800;
            font-size: 0.85rem;
            cursor: pointer;
            transition: filter 0.15s, transform 0.1s;
            letter-spacing: 0.3px;
        }
        .rs-btn-switch:hover:not(:disabled) { filter: brightness(1.15); transform: translateY(-1px); }
        .rs-btn-switch:disabled {
            background: #2a2a2a;
            color: #555;
            cursor: not-allowed;
            transform: none;
            filter: none;
        }

        /* Animation de sortie */
        #rs-modal.rs-closing {
            animation: rsPopOut 0.14s ease-in forwards;
        }
        @keyframes rsPopOut {
            to { opacity: 0; transform: scale(0.92) translateY(8px); }
        }
    `;
    document.head.appendChild(style);

    // ----------------------------------------------------------------
    // Badge dans la navbar (si slot existe)
    // ----------------------------------------------------------------
    function injectBadge() {
        const slot = document.getElementById('rs-badge-slot');
        if (!slot) return;
        const badge = document.createElement('span');
        badge.className = 'rs-badge';
        badge.title = 'Changer de mode';
        badge.innerHTML = `${active.icon} ${active.label}`;
        badge.onclick = openModal;
        slot.appendChild(badge);
    }

    // ----------------------------------------------------------------
    // Bouton flottant
    // ----------------------------------------------------------------
    function injectFAB() {
        const fab = document.createElement('button');
        fab.id = 'rs-fab';
        fab.innerHTML = `<span class="rs-fab-icon">${active.icon}</span><span>Changer de mode</span>`;
        fab.onclick = openModal;
        document.body.appendChild(fab);
    }

    // ----------------------------------------------------------------
    // Modale
    // ----------------------------------------------------------------
    let selectedKey = null;
    const overlay = document.createElement('div');
    overlay.id = 'rs-overlay';
    overlay.innerHTML = `
        <div id="rs-modal">
            <h2>Changer de mode</h2>
            <p class="rs-sub">Session conservée — aucune déconnexion</p>
            <div id="rs-options-list"></div>
            <div class="rs-actions">
                <button class="rs-btn-cancel" id="rs-cancel">Annuler</button>
                <button class="rs-btn-switch" id="rs-switch" disabled>Basculer</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    document.getElementById('rs-cancel').addEventListener('click', closeModal);
    document.getElementById('rs-switch').addEventListener('click', doSwitch);

    function buildOptions() {
        const list = document.getElementById('rs-options-list');
        list.innerHTML = available.map(m => {
            const isCurrent = m.key === active.key;
            return `
                <div class="rs-opt${isCurrent ? ' rs-opt-current' : ''}"
                     id="rs-opt-${m.key}"
                     ${isCurrent ? '' : `onclick="window.__rsSelect('${m.key}')"`}>
                    <span class="rs-opt-icon">${m.icon}</span>
                    <div class="rs-opt-text">
                        <div class="rs-opt-label">${m.label}</div>
                        <div class="rs-opt-desc">${m.desc}</div>
                    </div>
                    ${isCurrent
                        ? '<span class="rs-opt-current-tag">mode actuel</span>'
                        : '<div class="rs-radio"></div>'
                    }
                </div>`;
        }).join('');
    }

    window.__rsSelect = function (key) {
        selectedKey = key;
        document.querySelectorAll('.rs-opt').forEach(el => el.classList.remove('rs-opt-selected'));
        const el = document.getElementById(`rs-opt-${key}`);
        if (el) el.classList.add('rs-opt-selected');
        document.getElementById('rs-switch').disabled = false;
    };

    function openModal() {
        selectedKey = null;
        document.getElementById('rs-switch').disabled = true;
        buildOptions();
        const modal = document.getElementById('rs-modal');
        modal.classList.remove('rs-closing');
        overlay.classList.add('open');
    }

    function closeModal() {
        const modal = document.getElementById('rs-modal');
        modal.classList.add('rs-closing');
        setTimeout(() => {
            overlay.classList.remove('open');
            modal.classList.remove('rs-closing');
        }, 140);
    }

    function doSwitch() {
        if (!selectedKey) return;
        const target = MODES.find(m => m.key === selectedKey);
        if (!target) return;

        localStorage.setItem('active_mode', selectedKey);

        // Animation de sortie puis navigation
        const modal = document.getElementById('rs-modal');
        modal.classList.add('rs-closing');
        setTimeout(() => { window.location.href = target.url; }, 130);
    }

    // Exposer pour onclick navbar externe
    window.openRoleSwitcher = openModal;

    // ----------------------------------------------------------------
    // Init au chargement DOM
    // ----------------------------------------------------------------
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { injectFAB(); injectBadge(); });
    } else {
        injectFAB();
        injectBadge();
    }
})();
