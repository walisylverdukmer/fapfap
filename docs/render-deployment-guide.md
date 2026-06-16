# FAP FAP — Guide de déploiement Render

**Date :** 2026-06-16  
**Version :** v1.0.0-rc1  
**Architecture cible :**
- Backend : **Render** (Web Service Node.js)
- Frontend : **Vercel** (site statique)
- Base de données : **Neon PostgreSQL** (cloud, inchangé)

---

## Prérequis

- Compte Render : https://render.com
- Compte Vercel : https://vercel.com
- Dépôt git avec le tag `v1.0.0-rc1`
- Variables d'environnement prêtes (voir `docs/render-env-vars.md`)

---

## PARTIE 1 — Déploiement du backend sur Render

### 1.1 Créer un Web Service

```
Render Dashboard → New → Web Service
→ Connect a repository → Sélectionner le dépôt FAP FAP
```

### 1.2 Configurer le service

| Champ | Valeur |
|---|---|
| **Name** | `fapfap-backend` (ou votre choix) |
| **Region** | Frankfurt (EU) ou Oregon (US) |
| **Branch** | `master` |
| **Root Directory** | `server` |
| **Runtime** | `Node` |
| **Build Command** | `npm install --production` |
| **Start Command** | `npm start` |
| **Instance Type** | Free (bêta) ou Starter (production) |

> Le `Root Directory: server` fait que Render exécute `npm install` dans `server/`
> et lit `server/package.json`. C'est la configuration correcte.

### 1.3 Définir les variables d'environnement

Dans Render → Environment → Add Environment Variable :

| Variable | Valeur |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | _(générer ci-dessous)_ |
| `DATABASE_URL` | _(URL Neon complète)_ |
| `CORS_ORIGINS` | _(URL Vercel du client)_ |
| `TURN_TIMEOUT_MS` | `30000` |

> **Ne pas définir `PORT`** — Render l'injecte automatiquement.

Voir `docs/render-env-vars.md` pour le détail complet de chaque variable.

### 1.4 Générer un JWT_SECRET sécurisé

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Copier la sortie (128 caractères hexadécimaux) dans la variable `JWT_SECRET` de Render.
Ne jamais réutiliser le secret de développement.

### 1.5 Déployer

```
Render Dashboard → Manual Deploy → Deploy latest commit
```

Ou automatiquement à chaque `git push` sur `master` si l'auto-deploy est activé.

### 1.6 Vérifier le démarrage

Dans les logs Render, chercher :

```
🚀 Serveur Fap Fap 2026 opérationnel sur port XXXX
```

Absence de tout message `[FATAL]`. Si `[FATAL] JWT_SECRET absent` apparaît,
la variable d'environnement n'est pas correctement définie.

---

## PARTIE 2 — Déploiement du frontend sur Vercel

### 2.1 Mettre à jour `client/config.js`

Avant de déployer, modifier `client/config.js` pour pointer vers l'URL Render :

```js
// Remplacer par l'URL de votre service Render
const BACKEND_URL = 'https://fapfap-backend.onrender.com';
```

L'URL exacte est disponible dans Render → votre service → Settings → URL.

> **Important :** Cette ligne est le seul endroit à modifier pour changer de serveur.
> Tous les fichiers JS client (`game.js`, `script.js`, `dashboard.js`, etc.) utilisent
> `BACKEND_URL` défini dans ce fichier.

### 2.2 Créer `client/vercel.json`

```json
{
  "version": 2,
  "builds": [{ "src": "*.html", "use": "@vercel/static" }],
  "routes": [
    { "src": "/(.*)", "dest": "/$1" }
  ]
}
```

### 2.3 Déployer sur Vercel

**Option A — Via CLI :**
```bash
cd client/
npx vercel --prod
```

**Option B — Via interface Vercel :**
```
Vercel Dashboard → New Project → Import Git Repository
Root Directory : client/
Framework : Other (Static Site)
```

### 2.4 Récupérer l'URL Vercel

Après déploiement, Vercel fournit une URL du type :
```
https://fapfap.vercel.app
```

### 2.5 Mettre à jour CORS_ORIGINS sur Render

Dans Render → Environment, mettre à jour `CORS_ORIGINS` :
```
CORS_ORIGINS=https://fapfap.vercel.app
```

Puis redéployer le backend (Render → Manual Deploy).

---

## PARTIE 3 — Vérifications post-déploiement

Exécuter dans l'ordre après chaque déploiement :

### 3.1 Health check backend
```bash
curl https://fapfap-backend.onrender.com/api/auth/login \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"phone":"0700000001","password":"VotreMotDePasse"}'
# Attendu : 200 OK + { "token": "eyJ..." }
```

### 3.2 Vérifier CORS
```bash
curl -I https://fapfap-backend.onrender.com/api/auth/login \
  -H "Origin: https://fapfap.vercel.app"
# Attendu : Access-Control-Allow-Origin: https://fapfap.vercel.app
```

### 3.3 Vérifier WebSocket (Socket.IO)

Render supporte les WebSockets nativement sur tous les plans (y compris Free).
Aucune configuration supplémentaire requise.

Ouvrir le client Vercel → se connecter → rejoindre une table.
Dans les logs Render, vérifier l'apparition de :
```
📱 Connecté : <socket_id>
```

### 3.4 Vérifier rate limiting
```bash
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    https://fapfap-backend.onrender.com/api/auth/login \
    -X POST -H "Content-Type: application/json" \
    -d '{"phone":"0000000000","password":"wrong"}';
done
# Attendu : 400 × 10 puis 429 à partir du 11e
```

### 3.5 Test de partie complète
- 2 joueurs se connectent sur le client Vercel
- Rejoignent la même table
- Une partie démarre, un pli joué
- Le wallet du gagnant est crédité en base Neon

---

## PARTIE 4 — Compatibilité Render

| Fonctionnalité | Compatible Render ? | Notes |
|---|---|---|
| `process.env.PORT` | ✅ Oui | Render injecte `PORT` automatiquement |
| WebSocket / Socket.IO | ✅ Oui | Support natif WebSocket sur Render |
| État en RAM (`tables`) | ✅ Oui | Instance persistante (pas serverless) |
| PostgreSQL SSL | ✅ Oui | Neon exige SSL, `pg` pool configuré |
| `npm start` | ✅ Oui | Script `"start": "node server.js"` présent |
| `ROOT_DIR=server` | ✅ Oui | `package.json` à la racine de `server/` |
| Long-running process | ✅ Oui | Render = serveur persistant (≠ Vercel serverless) |

---

## PARTIE 5 — Procédure de rollback

### Rollback backend (Render)
```
Render Dashboard → votre service → Deployments
→ Sélectionner le déploiement précédent → Rollback to this deploy
```

### Rollback frontend (Vercel)
```
Vercel Dashboard → votre projet → Deployments
→ Sélectionner le déploiement précédent → Promote to Production
```

### Rollback base de données
La base Neon est en cloud avec transactions atomiques.
En cas de corruption :
```
Neon Dashboard → Branches → Create branch from checkpoint
```

---

## PARTIE 6 — Checklist complète de déploiement

### Avant déploiement

- [ ] `client/config.js` — `BACKEND_URL` mis à jour avec l'URL Render
- [ ] `JWT_SECRET` généré avec `crypto.randomBytes(64)` (≠ valeur dev)
- [ ] `DATABASE_URL` Neon vérifié et accessible depuis Render
- [ ] `CORS_ORIGINS` contient l'URL exacte Vercel (sans trailing slash)
- [ ] `NODE_ENV=production` défini dans Render
- [ ] `server/.env` absent du dépôt git (vérifié `.gitignore` ✅)
- [ ] `npm test` → 35/35 depuis `server/` en local ✅

### Déploiement backend (Render)

- [ ] Root Directory : `server`
- [ ] Build Command : `npm install --production`
- [ ] Start Command : `npm start`
- [ ] Toutes les variables d'environnement définies
- [ ] Déploiement déclenché
- [ ] Logs : `🚀 Serveur Fap Fap 2026 opérationnel sur port XXXX`
- [ ] Aucun `[FATAL]` dans les logs

### Déploiement frontend (Vercel)

- [ ] `client/vercel.json` créé
- [ ] `client/config.js` → `BACKEND_URL` = URL Render
- [ ] Déploiement Vercel déclenché
- [ ] URL Vercel récupérée
- [ ] `CORS_ORIGINS` sur Render mis à jour avec l'URL Vercel
- [ ] Backend redéployé après mise à jour CORS

### Post-déploiement

- [ ] `POST /api/auth/login` → token JWT valide
- [ ] `GET /api/admin/users` → liste des utilisateurs
- [ ] WebSocket : rejoindre une table → `📱 Connecté` dans les logs
- [ ] Partie à 2 joueurs → cartes distribuées, pli joué, wallet crédité
- [ ] Rate limiting : 429 après 10 tentatives
- [ ] CORS : pas d'erreur CORS dans la console navigateur

### Go / No-Go bêta

- [ ] Au moins 1 Katika créé avec son club
- [ ] Joueurs rechargés via `POST /api/money/transfer`
- [ ] Wali informé de l'URL `dashboard-pro.html`
- [ ] URL publique partagée avec les bêta-testeurs

---

## Architecture finale déployée

```
┌─────────────────────────────────────────────────────┐
│  JOUEURS (navigateurs)                              │
│  https://fapfap.vercel.app/*.html                   │
│  client/config.js → BACKEND_URL = Render URL        │
└──────────────────────┬──────────────────────────────┘
                       │ HTTPS + WSS (WebSocket sécurisé)
                       ▼
┌─────────────────────────────────────────────────────┐
│  BACKEND (Render Web Service — instance persistante) │
│  https://fapfap-backend.onrender.com                 │
│  node server/server.js                               │
│  PORT injecté par Render                             │
│  RAM : état des tables de jeu (tables{})             │
└──────────────────────┬──────────────────────────────┘
                       │ PostgreSQL SSL (DATABASE_URL)
                       ▼
┌─────────────────────────────────────────────────────┐
│  BASE DE DONNÉES (Neon PostgreSQL)                   │
│  DATABASE_URL=postgresql://...@neon.tech/...         │
│  Tables : users, clubs, audit_logs, game_sessions... │
└─────────────────────────────────────────────────────┘
```
