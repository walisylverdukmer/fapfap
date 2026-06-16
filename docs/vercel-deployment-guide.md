# FAP FAP — Guide de déploiement Vercel (RC1)

**Date :** 2026-06-16  
**Version :** v1.0.0-rc1  
**Hébergeur cible :** Vercel (backend) + GitHub Pages ou Vercel (client statique)

> **Note importante :** Vercel exécute les fonctions serverless sans état persistant entre les appels.
> Socket.IO a besoin d'une **connexion WebSocket longue durée** et d'un **état RAM** (la variable `tables`).
> Vercel Serverless Functions ne supportent pas cela nativement.
>
> **Recommandation :** Déployer le backend sur **Railway** ou **Render** (serveurs persistants).
> Ce guide couvre les deux options.

---

## Option A — Railway (recommandé pour le backend Socket.IO)

### Prérequis
- Compte Railway : https://railway.app
- Dépôt git avec le code (fait : `v1.0.0-rc1`)

### Étapes

**1. Créer un nouveau projet Railway**
```
Railway Dashboard → New Project → Deploy from GitHub repo
Sélectionner le dépôt FAP FAP → branche : master
```

**2. Configurer le répertoire de build**
Dans Railway → Settings → Build :
```
Root Directory : server
Build Command  : (vide — pas de build nécessaire)
Start Command  : node server.js
```

**3. Variables d'environnement à définir**

Dans Railway → Variables :

| Variable | Valeur | Obligatoire |
|---|---|---|
| `NODE_ENV` | `production` | ✅ Oui |
| `JWT_SECRET` | Voir génération ci-dessous | ✅ Oui |
| `DATABASE_URL` | URL Neon complète (avec `sslmode=require`) | ✅ Oui |
| `CORS_ORIGINS` | URL exacte du client déployé | ✅ Oui |
| `PORT` | Railway injecte automatiquement `PORT` — ne pas surcharger | ⚠️ Auto |
| `TURN_TIMEOUT_MS` | `30000` (30s) | Non (défaut) |

**4. Générer un JWT_SECRET sécurisé**
```bash
# Dans un terminal local :
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# Copier la sortie (128 hex chars) dans la variable Railway
```

**5. Configurer CORS_ORIGINS**
```
# Si le client est sur Vercel à https://fapfap.vercel.app :
CORS_ORIGINS=https://fapfap.vercel.app

# Si le client est sur un domaine custom :
CORS_ORIGINS=https://fapfap.example.com

# Plusieurs origins (séparées par virgule) :
CORS_ORIGINS=https://fapfap.vercel.app,https://www.fapfap.example.com
```

**6. Déployer**
```
Railway → Deploy → Déclenche automatiquement au push sur master
```

**7. Vérifier le démarrage**
Dans les logs Railway, chercher :
```
🚀 Serveur Fap Fap 2026 opérationnel sur port XXXX
```
Absence de tout message `[FATAL]`.

---

## Option B — Vercel (backend uniquement si pas de Socket.IO persistant)

> Vercel ne supporte pas Socket.IO avec état RAM. Ne pas utiliser pour le backend FAP FAP.
> Utiliser Vercel uniquement pour servir les fichiers statiques `client/`.

### Déploiement du client sur Vercel

**1. Configurer `vercel.json` à la racine `client/`**
```json
{
  "version": 2,
  "builds": [{ "src": "*.html", "use": "@vercel/static" }],
  "routes": [
    { "src": "/(.*)", "dest": "/$1" }
  ]
}
```

**2. Mettre à jour l'URL du serveur dans le client**

Dans `client/game.js` ligne 1 :
```js
// Avant (développement) :
const socket = io('http://localhost:5000');

// Après (production) :
const socket = io('https://ton-backend.railway.app');
```

Faire de même dans `client/script.js`, `client/dashboard.js`, `client/club.js`, `client/dashboard-pro.js`.

**3. Déployer sur Vercel**
```bash
cd client/
npx vercel --prod
```

---

## Render — Alternative à Railway

```
New Web Service → Connect GitHub repo
Root Directory  : server/
Build Command   : npm install
Start Command   : npm start
Environment     : Node
```
Même variables d'environnement que Railway.

---

## Vérifications post-déploiement

Exécuter dans l'ordre après chaque déploiement :

### 1. Health check backend
```bash
curl https://ton-backend.railway.app/api/auth/login \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"phone":"0700000001","password":"WaliPass123!"}'
# Attendu : 200 OK + { "token": "eyJ..." }
```

### 2. Vérifier CORS
```bash
curl -I https://ton-backend.railway.app/api/auth/login \
  -H "Origin: https://fapfap.vercel.app"
# Attendu : Access-Control-Allow-Origin: https://fapfap.vercel.app
```

### 3. Vérifier rate limiting
```bash
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    https://ton-backend.railway.app/api/auth/login \
    -X POST -H "Content-Type: application/json" \
    -d '{"phone":"0000000000","password":"wrong"}';
done
# Attendu : 400×10 puis 429 à partir du 11e
```

### 4. Vérifier Socket.IO
Ouvrir `client/index.html` depuis le navigateur, se connecter, rejoindre une table.
Vérifier dans les logs Railway l'apparition de `📱 Connecté : ...`.

### 5. Test complet d'une partie
- 2 joueurs rejoignent la table
- Dealer distribue
- 1 pli joué complet
- Vérifier que le wallet du gagnant est crédité en base

---

## Variables d'environnement — Tableau complet

| Variable | Dev (local) | Production | Notes |
|---|---|---|---|
| `NODE_ENV` | _(non défini)_ | `production` | Active les optimisations Express |
| `PORT` | `5000` | _(injecté par hébergeur)_ | Ne pas définir sur Railway/Render |
| `JWT_SECRET` | `9xK4!mP72@fapfap...` | **Nouveau secret 128 bits** | Rotation obligatoire entre envs |
| `DATABASE_URL` | URL Neon dev | URL Neon prod (ou DB séparée) | Idéalement 2 bases distinctes |
| `CORS_ORIGINS` | `http://localhost:5000` | URL(s) client(s) prod | Sans trailing slash |
| `TURN_TIMEOUT_MS` | `30000` | `30000` | Ajustable selon les parties |

---

## Procédure de rollback

### Rollback Railway (git tag)
```bash
# Identifier la version précédente
git tag -l
# → v1.0.0-rc1

# Déployer un commit spécifique dans Railway :
# Railway Dashboard → Deployments → Sélectionner le commit précédent → Redeploy
```

### Rollback manuel via git
```bash
# Revenir au commit tagué RC1 si des modifications ont été faites après
git checkout v1.0.0-rc1
git checkout -b hotfix/rollback-to-rc1
# Déployer cette branche dans Railway
```

### Rollback de base de données
> La base Neon est en cloud — les transactions SQL sont atomiques.
> En cas de corruption de données, Neon propose des branches de base de données :
```
Neon Dashboard → Branches → Create branch from checkpoint
```

---

## Checklist finale avant bêta

### Sécurité
- [ ] `JWT_SECRET` ≠ valeur de développement (régénéré avec `crypto.randomBytes(64)`)
- [ ] `NODE_ENV=production` défini
- [ ] `CORS_ORIGINS` contient uniquement les URLs autorisées (pas `*`, pas localhost)
- [ ] `DATABASE_URL` pointe sur la base de production (pas dev)
- [ ] `server/.env` absent du dépôt git (vérifié : dans `.gitignore` ✅)
- [ ] Connexion HTTPS active (automatique sur Railway/Render/Vercel)

### Fonctionnel
- [ ] `npm test` → 35/35 depuis `server/` en local
- [ ] Login Wali fonctionne sur l'URL prod
- [ ] Wallet visible après connexion
- [ ] Partie à 2 joueurs démarre, pli joué, gain crédité
- [ ] TCHIA rejeté si la main ne le permet pas (test de sécurité)

### Opérationnel
- [ ] Au moins 1 Katika créé avec son club
- [ ] Joueurs de test rechargés (`POST /api/money/transfer`)
- [ ] Logs Railway/Render accessibles pour monitoring
- [ ] Wali informé de l'URL `dashboard-pro.html`

### Recommandation monitoring
Activer les alertes Railway pour :
- Redémarrages inattendus (crashs)
- Utilisation mémoire > 80 %
- Latence réponse HTTP > 2s

---

## Architecture de déploiement recommandée RC1

```
┌─────────────────────────────────────────────────┐
│  CLIENT (navigateur)                            │
│  Vercel static : client/*.html + *.js + *.css   │
└────────────────────┬────────────────────────────┘
                     │ HTTP + WebSocket (WSS)
                     ▼
┌─────────────────────────────────────────────────┐
│  BACKEND (serveur persistant)                   │
│  Railway / Render                               │
│  node server/server.js                          │
│  Port : $PORT (auto)                            │
│  TLS : automatique                              │
└────────────────────┬────────────────────────────┘
                     │ PostgreSQL (SSL)
                     ▼
┌─────────────────────────────────────────────────┐
│  BASE DE DONNÉES                                │
│  Neon PostgreSQL (cloud)                        │
│  DATABASE_URL avec sslmode=require              │
└─────────────────────────────────────────────────┘
```
