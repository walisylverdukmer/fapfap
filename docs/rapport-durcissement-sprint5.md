# FAP FAP — Rapport de durcissement sécurité & production

**Date :** 2026-06-16  
**Sprint :** 5 — Qualité Production  
**Fichiers modifiés :**
- `server/server.js` — refactorisé (fonctions globales) + 6 corrections Sprint 5
- `server/controllers/authController.js` — rate limiting + suppression fallback JWT
- `server/middleware/authMiddleware.js` — suppression fallback JWT
- `server/.env` — ajout `CORS_ORIGINS`, `TURN_TIMEOUT_MS`

---

## 1. Rate limiting login

**Statut avant :** Aucune limitation — brute-force possible sur `/api/auth/login`  
**Statut après :** ✅ Corrigé

**Implémentation :** [`authController.js`](../server/controllers/authController.js) (lignes 8–27)

- Maximum **10 tentatives par IP** sur une fenêtre glissante de **15 minutes**
- Dès que le seuil est dépassé, la réponse est `429 Too Many Requests` avec message explicite
- Les entrées sont purgées automatiquement toutes les 30 minutes (pas de fuite mémoire)
- Sans dépendance externe (implémentation Map native)

```http
HTTP/1.1 429 Too Many Requests
{ "msg": "Trop de tentatives de connexion. Réessayez dans 15 minutes." }
```

**Note production :** Pour un déploiement derrière un reverse-proxy (Nginx, Cloudflare), ajouter `app.set('trust proxy', 1)` afin que `req.ip` reflète l'IP réelle du client et non celle du proxy.

---

## 2. CORS whitelist

**Statut avant :** `origin: "*"` — n'importe quel domaine pouvait appeler l'API et Socket.IO  
**Statut après :** ✅ Corrigé

**Implémentation :** [`server.js`](../server/server.js) (lignes 15–23)

- Liste blanche lue depuis `process.env.CORS_ORIGINS` (séparées par virgule)
- Valeur par défaut : `http://localhost:5000, http://127.0.0.1:5000`
- Requêtes sans origin (file://, outils dev) : autorisées (comporte `!origin`)
- Même whitelist appliquée à Express **et** à Socket.IO

**Action requise avant production :**  
Mettre à jour `CORS_ORIGINS` dans `.env` avec l'URL réelle du client :
```
CORS_ORIGINS=https://fapfap.mondomaine.com
```

---

## 3. Suppression du fallback JWT

**Statut avant :** `process.env.JWT_SECRET || 'votre_secret_fap_fap_2026'` — clé faible exposée dans le code source  
**Statut après :** ✅ Corrigé

**Implémentation :**
- [`server.js`](../server/server.js) — check fatal au démarrage : si `JWT_SECRET` absent → `process.exit(1)`
- [`authController.js`](../server/controllers/authController.js) ligne 114 — `jwt.sign(..., process.env.JWT_SECRET)`
- [`authMiddleware.js`](../server/middleware/authMiddleware.js) ligne 24 — `jwt.verify(..., process.env.JWT_SECRET)`

Si `JWT_SECRET` est absent du `.env`, le serveur refuse de démarrer avec un message clair :
```
[FATAL] JWT_SECRET absent du .env — arrêt immédiat.
```

Cela empêche tout déploiement silencieusement non sécurisé.

---

## 4. Persistance de la fraude en base

**Statut avant :** `player.suspiciousClaims` stocké uniquement en RAM — remis à zéro à chaque déconnexion/reconnexion  
**Statut après :** ✅ Corrigé

**Implémentation :** [`server.js`](../server/server.js)

**À la connexion (`join-table`) :**  
Le compteur de fraude est rechargé depuis `audit_logs` sur une fenêtre de 24h glissantes :
```sql
SELECT COUNT(*)::int AS cnt FROM audit_logs
WHERE user_id=$1 AND action='claim_fraud'
  AND created_at > NOW() - INTERVAL '24 hours'
```
Si un joueur avait 2 fraudes et se reconnecte, `suspiciousClaims` repart à 2. Le 3ème claim frauduleux le suspend immédiatement.

**À chaque claim frauduleux :**  
Une ligne est insérée dans `audit_logs` :
```json
{
  "action": "claim_fraud",
  "new_value": { "claimed": "TCHIA", "hand": [...], "attempt": 2 }
}
```

**Traçabilité :** La table `audit_logs` conserve l'historique complet des tentatives de fraude, consultable par le Wali.

---

## 5. Timer de tour

**Statut avant :** Aucun timer — un joueur AFK bloquait la partie indéfiniment  
**Statut après :** ✅ Corrigé

**Implémentation :** [`server.js`](../server/server.js) — fonctions `startTurnTimer` / `clearTurnTimer`

- **Durée configurable** via `TURN_TIMEOUT_MS` dans `.env` (défaut : 30 000 ms = 30 secondes)
- Le timer démarre automatiquement à chaque changement de tour :
  - Début de partie (`start-game`)
  - Après chaque `passTurn()`
  - Après chaque pli résolu (`determineTrickWinner` → 800ms + timer)
- Le timer est **annulé** dès qu'un joueur agit (`card-played`, `fold-hand`, `player-pass`, `claim-special-victory`)
- **Expiration :** le joueur est auto-banqué (`player-folded` avec `autoFold: true`), le tour passe au suivant
- Vérification `expectedPlayerId` : si le tour a déjà avancé avant l'expiration, le callback est neutralisé sans effet

**Événement client :** `player-folded` avec `{ autoFold: true }` — le client peut afficher un message spécifique.

---

## 6. Gestion des déconnexions en cours de partie

**Statut avant :** `handleDeparture` supprimait le joueur du tableau sans gérer la partie en cours : pot bloqué, `turnIndex` incohérent, partie gelée  
**Statut après :** ✅ Corrigé

**Implémentation :** [`server.js`](../server/server.js) — fonction `handleDeparture` refactorisée

**Séquence en cas de déconnexion pendant une partie :**

1. Le joueur est auto-banqué (`isInHand = false`, `hand = []`)
2. `player-folded` émis à la table avec `{ autoFold: true }`
3. Le joueur est retiré du tableau `table.players`
4. Les indices `dealerIndex` et `turnIndex` sont ajustés après suppression
5. Si **1 joueur actif restant** → `handleGameOver` déclenché immédiatement
6. Si **≥2 joueurs actifs** et c'était le tour du déconnecté → `passTurn()` déclenché
7. La mise du joueur déconnecté reste dans le pot (perdue)

**Résultat :** La partie continue sans intervention manuelle. Le timer du prochain joueur repart.

---

## 7. Vérification périodique des statuts utilisateurs

**Statut avant :** Un compte suspendu en cours de partie continuait à jouer jusqu'à déconnexion manuelle  
**Statut après :** ✅ Corrigé

**Implémentation :** [`server.js`](../server/server.js) — `setInterval` en bas du fichier

- Vérifie **toutes les 60 secondes** l'état de tous les utilisateurs connectés
- Requête unique groupée sur tous les `userId` connectés (`id=ANY($1)`)
- Si un compte est trouvé avec `status != 'active'` :
  - `force-disconnect` émis au socket concerné
  - Socket déconnecté de force (`socket.disconnect(true)`)
  - Retiré de `connectedSockets`
- Compatible avec la vérification déjà faite au `join-table` (défense en profondeur)

---

## Tableau de synthèse Sprint 5

| # | Correction | Fichier(s) | Statut |
|---|---|---|---|
| S5-01 | Rate limiting login (10 req/15min/IP) | `authController.js` | ✅ Implémenté |
| S5-02 | CORS whitelist (env-driven) | `server.js`, `.env` | ✅ Implémenté |
| S5-03 | Suppression fallback JWT | `server.js`, `authController.js`, `authMiddleware.js` | ✅ Implémenté |
| S5-04 | Persistance fraude en `audit_logs` | `server.js` | ✅ Implémenté |
| S5-05 | Timer de tour (30s configurable) | `server.js`, `.env` | ✅ Implémenté |
| S5-06 | Déconnexion en cours de partie | `server.js` | ✅ Implémenté |
| S5-07 | Vérification statuts périodique (60s) | `server.js` | ✅ Implémenté |

---

## Refactoring architectural inclus

La refactorisation la plus importante de ce sprint est le **déplacement des fonctions de jeu en dehors du callback `io.on('connection')`**.

**Avant :** `logAction`, `passTurn`, `determineTrickWinner`, `checkFinalReveal`, `handleGameOver`, `handleDeparture` étaient définies **dans** le callback de connexion — impossible à appeler depuis les timers ou les tâches périodiques.

**Après :** Ces fonctions sont au niveau module. Elles n'utilisent que `io`, `tables`, `db` (tous à portée module), et reçoivent `socket` en paramètre quand nécessaire.

Ce changement était **requis** pour implémenter les timers de tour et la vérification périodique.

---

## Points d'attention restants avant production

| Priorité | Action | Raison |
|---|---|---|
| **Critique** | Définir `CORS_ORIGINS` avec l'URL prod | Actuellement restreint à localhost |
| **Haute** | Activer `trust proxy` si derrière Nginx/Cloudflare | Rate limiting par IP correct |
| **Haute** | Supprimer `cheatBtn` dans `client/game.js` (BUG-07) | Bouton de test visible en prod |
| **Moyenne** | Ajouter `HTTPS` / TLS | Tokens JWT en clair sur HTTP |
| **Moyenne** | Implémenter `helmet()` (headers de sécurité) | CSP, HSTS, X-Frame-Options |
| **Faible** | Migrer vers `express-rate-limit` (package) | Plus robuste (Redis backend pour multi-instance) |
