// ================================================================
// FAP FAP — Garde d'authentification centralisée
// Charger dans <head> de chaque page protégée, AVANT tout autre script.
// ================================================================
(function () {
    'use strict';

    // Masquer immédiatement le body pour éviter tout flash de contenu
    // protégé avant que la vérification soit terminée.
    const _hideStyle = document.createElement('style');
    _hideStyle.id    = '__auth_hide';
    _hideStyle.textContent = 'body { visibility: hidden !important; }';
    document.head.appendChild(_hideStyle);

    // ──────────────────────────────────────────────
    // Helpers internes
    // ──────────────────────────────────────────────

    function _readToken() {
        return localStorage.getItem('token') || null;
    }

    function _readUser() {
        try {
            return JSON.parse(localStorage.getItem('user')) || null;
        } catch {
            return null;
        }
    }

    // Décodage du payload JWT (sans bibliothèque externe)
    function _decodeJwt(token) {
        try {
            const b64 = token.split('.')[1]
                .replace(/-/g, '+')
                .replace(/_/g, '/');
            return JSON.parse(atob(b64));
        } catch {
            return null;
        }
    }

    // Vrai si le token existe et n'est pas expiré
    function _isTokenValid(token) {
        if (!token) return false;
        const payload = _decodeJwt(token);
        if (!payload || !payload.exp) return false;
        // exp est en secondes (UNIX), Date.now() en ms
        return payload.exp * 1000 > Date.now();
    }

    // Restaurer la visibilité du body
    function _show() {
        const el = document.getElementById('__auth_hide');
        if (el) el.parentNode.removeChild(el);
    }

    // ──────────────────────────────────────────────
    // Vérification immédiate (token + expiry)
    // Interrompt le chargement de la page si invalide.
    // ──────────────────────────────────────────────
    const _token = _readToken();
    const _user  = _readUser();

    if (!_token || !_user || !_isTokenValid(_token)) {
        // Nettoyer et rediriger sans créer d'entrée dans l'historique
        localStorage.clear();
        sessionStorage.clear();
        window.location.replace('index.html');
        // On ne retire PAS le style hide — la page reste invisible pendant la navigation
    }

    // ──────────────────────────────────────────────
    // API publique
    // ──────────────────────────────────────────────
    window.AuthGuard = {

        /**
         * À appeler au tout début du JS de chaque page protégée.
         * @param {string[]} allowedRoles — si vide, tout rôle connecté est accepté
         * @returns {boolean} true si l'accès est autorisé (body dévoilé), false sinon
         */
        require: function (allowedRoles) {
            const token = _readToken();
            const user  = _readUser();

            if (!token || !user || !_isTokenValid(token)) {
                this.logout();
                return false;
            }

            if (allowedRoles && allowedRoles.length > 0) {
                if (!allowedRoles.includes(user.role)) {
                    this.logout();
                    return false;
                }
            }

            // Auth OK — rendre la page visible
            _show();

            // Bloquer le retour arrière sur les pages protégées après logout.
            // Après un logout (replace → index.html), cette page ne sera plus
            // dans la pile d'historique. Si l'utilisateur y revient via le cache,
            // le guard ci-dessus intercepte (body reste caché) et redirige.
            history.replaceState(null, '', window.location.href);

            return true;
        },

        /**
         * Déconnexion complète : nettoie tout, redirige vers login.
         */
        logout: function () {
            localStorage.clear();
            sessionStorage.clear();
            window.location.replace('index.html');
        },

        /** Accès rapide aux données de session (lecture seule) */
        getUser:  _readUser,
        getToken: _readToken,

        /** Vrai si le token courant est valide (non expiré) */
        isAuthenticated: function () {
            return _isTokenValid(_readToken()) && !!_readUser();
        }
    };

})();
