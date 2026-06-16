# FAP FAP — Known Limitations v1.0.0-rc1

**Date :** 2026-06-16  
**Version :** v1.0.0-rc1  
Ce document liste les limitations connues de la RC1, classées par criticité.

---

## 🔴 Bloquants pour production publique (non bloquants pour bêta fermée)

### KL-01 — Recharges joueur non implémentées

**Impact :** Les joueurs ne peuvent pas demander de recharge depuis l'interface.  
**Workaround bêta :** Le Katika ou le Wali effectue un transfert direct via `POST /api/money/transfer`.  
**Fichier :** `server/controllers/rechargeController.js` — stub sans logique  
**Effort estimé :** ~4h (endpoint create + endpoint validate + notification Socket.IO)

### KL-02 — Pas de HTTPS configuré

**Impact :** Les tokens JWT transitent en clair sur HTTP.  
**Workaround bêta :** Déployer sur Vercel ou Railway (HTTPS automatique), ou VPN fermé.  
**Action :** Configurer un certificat TLS côté hébergeur — aucun code à modifier.

### KL-03 — `CORS_ORIGINS` pointe sur localhost

**Impact :** En production, les requêtes depuis le domaine réel seront bloquées.  
**Action :** Définir `CORS_ORIGINS=https://ton-domaine.com` dans les variables d'environnement du serveur.

---

## 🟡 Non bloquants — À corriger avant v1.0.0 stable

### KL-04 — Règle Passe : pas de limite sur le nombre de passeurs

**Impact :** Théoriquement tous les joueurs peuvent passer. Si tous passent, le gagnant est le passeur avec la valeur la plus haute, ce qui est correct mais non documenté dans les règles officielles.  
**Fichier :** `server/server.js` — `player-pass` handler  
**Effort estimé :** ~1h (ajouter vérif `table.players.filter(p => p.isPassing).length < n - 1`)

### KL-05 — Pas de compte à rebours visible côté client

**Impact :** Le joueur actif ne sait pas qu'un timer de 30s court. Il est auto-banqué sans avertissement préalable.  
**Fichier :** `client/game.js`  
**Effort estimé :** ~2h (afficher countdown dans `updateTurnUI`, synchroniser avec `next-turn`)

### KL-06 — Rate limiting en mémoire (non persistant, mono-instance)

**Impact :** Un redémarrage du serveur remet les compteurs à zéro. En multi-instance, chaque instance a son propre compteur.  
**Workaround :** Acceptable pour la bêta (instance unique).  
**Solution production :** Migrer vers `express-rate-limit` avec adaptateur Redis.

### KL-07 — `app.set('trust proxy')` non configuré

**Impact :** Derrière Nginx ou Cloudflare, `req.ip` retourne l'IP du proxy, pas du client. Tout le monde partage le même compteur de rate limiting.  
**Action :** Ajouter `app.set('trust proxy', 1)` dans `server.js` si déploiement derrière un proxy.

### KL-08 — Headers de sécurité HTTP absents

**Impact :** Pas de CSP, HSTS, X-Frame-Options, X-Content-Type-Options.  
**Solution :** Installer et configurer `helmet` : `app.use(require('helmet')())`.  
**Effort estimé :** 30 min.

### KL-09 — `requestMoney()` absent dans `client/player-view.html`

**Impact :** Le formulaire de recharge dans la vue joueur n'est pas fonctionnel (bouton sans action).  
**Lié à :** KL-01  
**Effort estimé :** Inclus dans KL-01.

---

## 🟢 Mineurs — Qualité / UX

### KL-10 — Mélange `Math.random()` non cryptographique

**Impact :** Fisher-Yates est correctement implémenté mais `Math.random()` n'est pas un CSPRNG. En pratique non exploitable pour un jeu de cartes récréatif.  
**Solution théorique :** Utiliser `crypto.getRandomValues()` via `node:crypto`.

### KL-11 — Pas de règle "suivre couleur ou défausser" côté client

**Impact :** Le client affiche toutes les cartes comme jouables même quand certaines sont interdites. L'erreur n'apparaît qu'après tentative (rejet serveur).  
**Amélioration UX :** Griser les cartes non jouables dans `renderHand()` dès qu'une carte d'entame est posée.

### KL-12 — `gameRoutes.js` et `gameManager.js` sont des fichiers vides

**Impact :** Dette technique — la logique jeu est intégralement dans `server.js`.  
**Impact opérationnel :** Aucun pour la bêta.  
**Action future :** Refactorer vers `gameManager.js` pour les sprints suivants.

### KL-13 — `console.log` en production

**Impact :** Logs verbeux (`📱 Connecté : ...`) non filtrés par `NODE_ENV`.  
**Solution :** Conditionner les logs de debug à `process.env.NODE_ENV !== 'production'` ou utiliser un logger (Winston, Pino).

### KL-14 — Pas de pagination sur `getSanctions`

**Impact :** La requête retourne 200 résultats max (Wali) ou 50 (Katika), hardcodés.  
**Action future :** Ajouter `LIMIT / OFFSET` avec paramètres de pagination.

---

## Tableau de suivi

| ID | Criticité | Bêta OK ? | Sprint cible |
|---|---|---|---|
| KL-01 Recharges | 🔴 Haute | ⚠️ Workaround | Sprint 6 |
| KL-02 HTTPS | 🔴 Haute | ✅ Si Vercel/Railway | Déploiement |
| KL-03 CORS prod | 🔴 Haute | ✅ Config .env | Déploiement |
| KL-04 Limite passeurs | 🟡 Moyenne | ✅ | Sprint 6 |
| KL-05 Timer client | 🟡 Moyenne | ✅ | Sprint 6 |
| KL-06 Rate limit RAM | 🟡 Moyenne | ✅ | Prod v2 |
| KL-07 Trust proxy | 🟡 Moyenne | ✅ | Déploiement |
| KL-08 Helmet | 🟡 Moyenne | ✅ | Sprint 6 |
| KL-09 requestMoney | 🟡 Moyenne | ✅ Workaround | Sprint 6 |
| KL-10 CSPRNG | 🟢 Faible | ✅ | Post v1 |
| KL-11 Cartes grises client | 🟢 Faible | ✅ | Sprint 6 |
| KL-12 Fichiers vides | 🟢 Faible | ✅ | Refactor |
| KL-13 Logs prod | 🟢 Faible | ✅ | Sprint 6 |
| KL-14 Pagination sanctions | 🟢 Faible | ✅ | Post v1 |
