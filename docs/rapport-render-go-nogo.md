# FAP FAP — Rapport d'audit Render : GO / NO GO

**Date :** 2026-06-16  
**Version :** v1.0.0-rc1  
**Auditeur :** Claude Sonnet 4.6  
**Contrainte :** Aucune logique métier modifiée — préparation déploiement uniquement.

---

## Résultat global

```
┌─────────────────────────────────────┐
│                                     │
│         ✅  GO POUR RENDER          │
│                                     │
│  Sous conditions (3 actions avant   │
│  déploiement — documentées ci-bas)  │
│                                     │
└─────────────────────────────────────┘
```

---

## Audit détaillé

### 1. Compatibilité Render

| Point vérifié | Statut | Détail |
|---|---|---|
| `process.env.PORT` | ✅ OK | `const PORT = process.env.PORT \|\| 5000` — ligne 872 |
| Script `npm start` | ✅ OK | `"start": "node server.js"` dans `package.json` |
| `Root Directory: server` | ✅ OK | `package.json` à la racine de `server/` |
| WebSocket / Socket.IO | ✅ OK | Render supporte WebSocket nativement (tous plans) |
| Instance persistante | ✅ OK | Render = Web Service long-running (≠ Vercel serverless) |
| État RAM (`tables{}`) | ✅ OK | Instance unique persistante — compatible |
| PostgreSQL SSL | ✅ OK | Pool `pg` avec `ssl: { rejectUnauthorized: false }` |
| Démarrage sans `.env` | ✅ OK | Variables injectées par Render, lues via `process.env` |

---

### 2. Dépendances (`server/package.json`)

| Vérification | Statut | Action |
|---|---|---|
| Toutes les dépendances prod déclarées | ✅ OK | `bcryptjs`, `cors`, `dotenv`, `express`, `jsonwebtoken`, `pg`, `socket.io` |
| `nodemon` en devDependencies | ✅ CORRIGÉ | Déplacé de `dependencies` → `devDependencies` |
| `mysql2/promise` non déclaré | ✅ NON BLOQUANT | Utilisé uniquement dans `seed.js` (script legacy MySQL, non exécuté au démarrage) |
| `socket.io-client` | ✅ OK | En `devDependencies` — non chargé en production |
| `http` (built-in Node.js) | ✅ OK | Module natif, aucune installation requise |

> `npm install --production` sur Render n'installe pas `devDependencies`.
> `nodemon` ne sera pas téléchargé en production. ✅

---

### 3. Variables d'environnement

| Variable | Statut | Action requise |
|---|---|---|
| `JWT_SECRET` | ✅ Vérifiée | Serveur refuse de démarrer si absente |
| `DATABASE_URL` | ✅ Vérifiée | Pool pg lit cette variable |
| `CORS_ORIGINS` | ✅ Vérifiée | CORS bloqué si variable absente (fallback localhost) |
| `NODE_ENV` | ⚠️ À DÉFINIR | Non défini par défaut — définir `production` sur Render |
| `PORT` | ✅ Automatique | Render injecte, code lit `process.env.PORT \|\| 5000` |
| `TURN_TIMEOUT_MS` | ✅ Optionnel | Défaut 30000ms si absent |

---

### 4. URLs hardcodées — CLIENT

| Fichier | Statut | Action |
|---|---|---|
| `client/game.js` | ✅ CORRIGÉ | `io(BACKEND_URL)` |
| `client/script.js` | ✅ CORRIGÉ | `BACKEND_URL + '/api/auth/login'` |
| `client/club-manage.js` (×3) | ✅ CORRIGÉ | `BACKEND_URL + '/api/...'` |
| `client/dashboard-pro.js` (×3) | ✅ CORRIGÉ | `BACKEND_URL + '/api/...'` |
| `client/dashboard.js` | ✅ CORRIGÉ | `BACKEND_URL + '/api/...'` |
| `client/config.js` | ✅ CRÉÉ | Point de configuration unique — modifier avant déploiement |
| HTML (×5 fichiers) | ✅ CORRIGÉ | `<script src="config.js">` ajouté avant chaque app script |

> **Action requise :** Avant de déployer le frontend, modifier `client/config.js` :
> ```js
> const BACKEND_URL = 'https://fapfap-backend.onrender.com';
> ```

---

### 5. Logs sensibles

| Fichier | Type | Statut |
|---|---|---|
| `server/server.js` | `console.log` connexion socket | ✅ Acceptable — pas de données sensibles |
| `server/server.js` | `console.warn` fraudes/violations | ✅ Acceptable — logs de sécurité |
| `server/server.js` | `console.error` exceptions | ✅ Acceptable — logs d'erreur |
| `server/init_db.js` | `console.log("Pass: Jolies")` | ⚠️ Sensible — script non exécuté au démarrage |
| `server/authController.js` | `console.warn` rate limit + IP | ✅ Acceptable — logs de sécurité |

> `init_db.js` et `seed.js` sont des scripts utilitaires locaux.
> Ils **ne sont pas exécutés** au démarrage du serveur et ne sont pas dans le `scripts.start`.
> Non bloquants pour le déploiement, mais à ne jamais exécuter sur la base de production.

---

### 6. Mots de passe hardcodés / secrets

| Fichier | Contenu | Statut |
|---|---|---|
| `server/seed.js` | `password: ''` (MySQL localhost) | ✅ Script legacy, non exécuté |
| `server/reset_wali.js` | `const pass = "Jolies"` | ✅ Script utilitaire, non exécuté |
| `server/authController.js` | `bcrypt.hash(password, salt)` | ✅ OK — hash dynamique |
| Tout le reste | Aucun secret hardcodé | ✅ OK |

> `seed.js` et `reset_wali.js` sont des reliquats de la migration MySQL → PostgreSQL.
> Ils ne sont pas référencés dans `package.json` scripts.
> Non bloquants. Peuvent être supprimés lors du Sprint 6 (nettoyage dette technique).

---

### 7. Compatibilité WebSocket Render

Render supporte les WebSockets nativement sur **tous les plans** (y compris Free).
- Pas de configuration nginx supplémentaire requise
- Pas d'en-tête spécial à ajouter
- Socket.IO gère automatiquement l'upgrade HTTP → WebSocket
- Le plan Free met le service en veille après 15 min d'inactivité (cold start ~30s)

> Pour la bêta fermée, le plan Free est suffisant.
> Pour une utilisation continue, passer au plan Starter ($7/mois) qui désactive la mise en veille.

---

### 8. `trust proxy` (KL-07)

Le backend est déployé derrière le proxy Render. Sans `app.set('trust proxy', 1)`,
`req.ip` retourne l'IP du proxy Render, pas celle du client.

**Impact bêta :** Le rate limiting basé sur IP (`isRateLimited(clientIp)`) se compte
par IP proxy, pas par utilisateur réel. Tous les utilisateurs partagent le même compteur.

**Statut :** Non bloquant pour la bêta fermée (peu d'utilisateurs).
**Action post-bêta :** Ajouter `app.set('trust proxy', 1)` dans `server.js` (KL-07).

---

## Récapitulatif des actions à effectuer

### Avant déploiement (obligatoires)

| # | Action | Fichier | Statut |
|---|---|---|---|
| 1 | Définir `NODE_ENV=production` sur Render | Render Dashboard | A FAIRE |
| 2 | Générer et définir `JWT_SECRET` (128 bits) | Render Dashboard | A FAIRE |
| 3 | Définir `DATABASE_URL` (Neon prod) | Render Dashboard | A FAIRE |
| 4 | Définir `CORS_ORIGINS` avec URL Vercel | Render Dashboard | A FAIRE |
| 5 | Mettre à jour `client/config.js` avec URL Render | `client/config.js` | A FAIRE |

### Déjà corrigés dans cette session

| # | Correction | Fichier(s) |
|---|---|---|
| C1 | `nodemon` déplacé en devDependencies | `server/package.json` |
| C2 | 9 URLs `localhost:5000` remplacées par `BACKEND_URL` | 5 fichiers client JS |
| C3 | `<script src="config.js">` ajouté | 5 fichiers HTML |
| C4 | `client/config.js` créé (point de config unique) | nouveau fichier |

### Non bloquants (backlog Sprint 6)

| # | Item | Fichier |
|---|---|---|
| B1 | Supprimer `seed.js` (legacy MySQL) | `server/seed.js` |
| B2 | Supprimer/réécrire `reset_wali.js` (MySQL syntax) | `server/reset_wali.js` |
| B3 | Ajouter `app.set('trust proxy', 1)` | `server/server.js` |
| B4 | Passer au plan Render Starter (pas de mise en veille) | Render Dashboard |

---

## Verdict final

```
AUDIT RENDER : GO ✅

Blocants levés : 2/2
  - URLs localhost hardcodées → corrigées (config.js)
  - nodemon en dependencies → déplacé en devDependencies

Actions manuelles restantes : 5 (variables d'environnement + config.js URL)
Non bloquants : 4 (backlog Sprint 6)

Le backend est architecturalement compatible Render.
Socket.IO WebSocket fonctionne sur Render Free et Starter.
La base Neon PostgreSQL est accessible depuis Render (SSL ok).
Le déploiement peut procéder dès que les 5 variables d'env sont définies.
```
