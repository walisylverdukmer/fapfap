// =====================================================
// FAP FAP 2.1 — Game Scale Engine
// - fitTable() : met à l'échelle la table poker
// - Détection portrait → modal rotation
// - Drawers mobiles (historique + chat)
// =====================================================

(function () {
    'use strict';

    // Dimensions natives de la table (voir game.html / game-layout.css)
    var TABLE_W         = 900;
    var TABLE_H         = 520;
    var SLOT_OVERHANG_V = 65 + 130; // slots haut/bas + main cartes (portion sous la table)
    var SLOT_OVERHANG_T = 65;       // slot du haut (au-dessus)
    var MOBILE_BP       = 900;      // breakpoint mobile (élargi à 900 pour tablettes)

    // ── Mise à l'échelle ────────────────────────────

    function fitTable() {
        var table = document.querySelector('.poker-table');
        if (!table) return;

        var hdr   = document.querySelector('.admin-header');
        var hdrH  = hdr ? hdr.offsetHeight : 62;

        var vw    = window.innerWidth;
        var vh    = window.innerHeight;
        var isMob = vw <= MOBILE_BP;

        // Paysage mobile : header réduit + overhangs compressés
        var isMobLandscape = isMob && (vw > vh);
        var hdrEff = isMobLandscape ? Math.min(hdrH, 44) : hdrH;
        var ovhT   = isMobLandscape ? 30  : SLOT_OVERHANG_T;   // slot haut presque invisible
        var ovhB   = isMobLandscape ? 105 : SLOT_OVERHANG_V;   // main compressée en paysage

        // Espace disponible
        var availW = vw;                            // sidebars en tiroir sur mobile
        var margin = isMobLandscape ? 8 : 20;
        var availH = vh - hdrEff - margin;

        // Hauteur totale occupée par l'ensemble table+slots+cartes
        var totalH = TABLE_H + ovhT + ovhB;

        var scaleX = availW / TABLE_W;
        var scaleY = availH / totalH;
        // Sur mobile (pas de sidebars), on peut dépasser légèrement 1
        var maxScale = isMob ? 1.2 : 1.0;
        var scale  = Math.min(scaleX, scaleY, maxScale);

        // Appliquer la transformation
        table.style.transform       = 'scale(' + scale + ')';
        table.style.transformOrigin = 'top center';

        // Recalculer marginTop pour combler l'espace "volé" par le scale
        var naturalMarginTop = hdrEff + 18 + ovhT;
        var shrinkageV       = (1 - scale) * (TABLE_H + ovhT);
        table.style.marginTop    = Math.max(naturalMarginTop - shrinkageV / 2, hdrEff + 6) + 'px';
        table.style.marginBottom = '0px';
    }

    // ── Modal orientation ────────────────────────────

    function checkOrientation() {
        var modal     = document.getElementById('orientation-modal');
        if (!modal) return;

        var isPortrait = window.innerHeight > window.innerWidth;
        var isTooSmall = window.innerWidth < MOBILE_BP;

        // Afficher si portrait + petit écran (jeu injouable en portrait mobile)
        modal.style.display = (isPortrait && isTooSmall) ? 'flex' : 'none';
    }

    // ── Drawers mobiles ──────────────────────────────

    var drawerOpen = null; // 'history' | 'chat' | null

    function openDrawer(which) {
        var hist    = document.querySelector('.history-panel');
        var chat    = document.querySelector('.chat-panel');
        var overlay = document.getElementById('drawer-overlay');
        if (!hist || !chat) return;

        closeDrawer(false);
        drawerOpen = which;

        if (which === 'history') hist.classList.add('drawer-open');
        if (which === 'chat')    chat.classList.add('drawer-open');
        if (overlay)             overlay.classList.add('open');
    }

    function closeDrawer(resetOverlay) {
        if (resetOverlay === undefined) resetOverlay = true;
        var hist    = document.querySelector('.history-panel');
        var chat    = document.querySelector('.chat-panel');
        var overlay = document.getElementById('drawer-overlay');
        if (hist) hist.classList.remove('drawer-open');
        if (chat) chat.classList.remove('drawer-open');
        if (overlay && resetOverlay) overlay.classList.remove('open');
        drawerOpen = null;
    }

    function toggleDrawer(which) {
        if (drawerOpen === which) closeDrawer();
        else openDrawer(which);
    }

    // ── Injecter les éléments drawer si absents ──────

    function injectDrawerUI() {
        // Ne rien injecter si déjà présent
        if (document.getElementById('drawer-overlay')) return;

        // Overlay
        var overlay = document.createElement('div');
        overlay.id  = 'drawer-overlay';
        overlay.className = 'drawer-overlay';
        overlay.addEventListener('click', function () { closeDrawer(); });
        document.body.appendChild(overlay);

        // Bouton historique
        if (!document.querySelector('.drawer-toggle-history')) {
            var btnH = document.createElement('button');
            btnH.className = 'drawer-toggle drawer-toggle-history';
            btnH.title     = 'Historique';
            btnH.innerHTML = '📜';
            btnH.addEventListener('click', function () { toggleDrawer('history'); });
            document.body.appendChild(btnH);
        }

        // Bouton chat
        if (!document.querySelector('.drawer-toggle-chat')) {
            var btnC = document.createElement('button');
            btnC.className = 'drawer-toggle drawer-toggle-chat';
            btnC.title     = 'Chat';
            btnC.innerHTML = '💬';
            btnC.addEventListener('click', function () { toggleDrawer('chat'); });
            document.body.appendChild(btnC);
        }
    }

    // ── Injecter la modal orientation si absente ─────

    function injectOrientationModal() {
        if (document.getElementById('orientation-modal')) return;
        var modal = document.createElement('div');
        modal.id  = 'orientation-modal';
        modal.innerHTML = [
            '<div class="orientation-icon">📱</div>',
            '<div class="orientation-title">Tournez votre téléphone</div>',
            '<div class="orientation-hint">FAP FAP se joue en mode paysage pour une meilleure expérience.</div>'
        ].join('');
        document.body.appendChild(modal);
    }

    // ── Cycle principal ──────────────────────────────

    function run() {
        injectDrawerUI();
        injectOrientationModal();
        fitTable();
        checkOrientation();
    }

    // ── Exports globaux ──────────────────────────────
    window.fitTable         = fitTable;
    window.checkOrientation = checkOrientation;
    window.openDrawer       = openDrawer;
    window.closeDrawer      = closeDrawer;
    window.toggleDrawer     = toggleDrawer;

    // ── Listeners ────────────────────────────────────
    document.addEventListener('DOMContentLoaded', run);
    window.addEventListener('resize', function () { fitTable(); checkOrientation(); });
    window.addEventListener('orientationchange', function () {
        setTimeout(run, 300); // 300ms pour laisser le navigateur finir la rotation
    });

})();
