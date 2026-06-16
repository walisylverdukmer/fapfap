# FAP FAP — Variables d'environnement Render

**Date :** 2026-06-16  
**Version :** v1.0.0-rc1

Ce document liste toutes les variables d'environnement à définir dans
Render Dashboard → votre service → Environment.

---

## Variables obligatoires

### `NODE_ENV`

| Clé | `NODE_ENV` |
|---|---|
| Valeur | `production` |
| Obligatoire | Oui |
| Impact | Active les optimisations Express, désactive le mode debug |

```
NODE_ENV=production
```

---

### `JWT_SECRET`

| Clé | `JWT_SECRET` |
|---|---|
| Valeur | Chaîne aléatoire ≥128 bits (64 octets hex) |
| Obligatoire | Oui — le serveur refuse de démarrer sans elle |
| Impact | Signe et vérifie tous les tokens JWT (24h d'expiry) |

**Générer une valeur sécurisée :**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Exemple de sortie (ne pas utiliser cet exemple) :
```
a3f7c2e1d9b84f56a2c3e1d7f9b4a2c3e1d7f9b4a2c3e1...
```

> Ne jamais réutiliser le `JWT_SECRET` de développement (fichier `server/.env`).
> Une rotation du secret invalide toutes les sessions actives.

---

### `DATABASE_URL`

| Clé | `DATABASE_URL` |
|---|---|
| Valeur | URL de connexion Neon complète |
| Obligatoire | Oui |
| Impact | Toutes les requêtes SQL (users, wallets, audit_logs, etc.) |

**Format :**
```
postgresql://username:password@ep-xxxx.eu-central-1.aws.neon.tech/dbname?sslmode=require
```

**Où trouver cette URL :**
```
Neon Dashboard → votre projet → Connection Details → Connection string
```

> Le `?sslmode=require` est obligatoire. Neon refuse les connexions non-SSL.
> Le pool pg (`config/db.js`) est configuré avec `ssl: { rejectUnauthorized: false }`.

---

### `CORS_ORIGINS`

| Clé | `CORS_ORIGINS` |
|---|---|
| Valeur | URL(s) exacte(s) du client Vercel |
| Obligatoire | Oui |
| Impact | Bloque les requêtes de toute autre origine |

**Format (une URL) :**
```
CORS_ORIGINS=https://fapfap.vercel.app
```

**Format (plusieurs URLs) :**
```
CORS_ORIGINS=https://fapfap.vercel.app,https://www.fapfap.example.com
```

> Sans trailing slash. Sans espace autour de la virgule.
> Le backend bloque toute origine absente de cette liste (CORS bloqué → HTTP 403).

---

## Variables optionnelles

### `TURN_TIMEOUT_MS`

| Clé | `TURN_TIMEOUT_MS` |
|---|---|
| Valeur | `30000` (30 secondes) |
| Obligatoire | Non — défaut : 30000 |
| Impact | Délai avant auto-banque d'un joueur AFK |

```
TURN_TIMEOUT_MS=30000
```

Ajuster si les joueurs signalent des banques trop rapides (ex: `45000` pour 45s).

---

### `PORT`

| Clé | `PORT` |
|---|---|
| Valeur | _(ne pas définir)_ |
| Obligatoire | Non |
| Impact | Render injecte automatiquement `PORT` |

> Ne **jamais** définir `PORT` manuellement sur Render.
> Le code utilise `process.env.PORT || 5000` — Render injecte la valeur correcte.

---

## Tableau récapitulatif

| Variable | Dev (local) | Production Render | Obligatoire |
|---|---|---|---|
| `NODE_ENV` | _(non défini)_ | `production` | ✅ Oui |
| `JWT_SECRET` | _(dans server/.env)_ | Nouveau secret 128 bits | ✅ Oui |
| `DATABASE_URL` | _(dans server/.env)_ | URL Neon production | ✅ Oui |
| `CORS_ORIGINS` | `http://localhost:5000` | URL(s) Vercel | ✅ Oui |
| `TURN_TIMEOUT_MS` | `30000` | `30000` | Non (défaut) |
| `PORT` | `5000` (fallback) | _(injecté par Render)_ | Non (auto) |

---

## Sécurité — Ce qu'il ne faut jamais faire

- Ne jamais commiter `server/.env` — il est dans `.gitignore` ✅
- Ne jamais utiliser `JWT_SECRET=secret` ou une valeur courte
- Ne jamais mettre `CORS_ORIGINS=*` (wildcard) en production
- Ne jamais exposer `DATABASE_URL` dans les logs ou le code source
- Ne jamais réutiliser les credentials entre environnement dev et prod
