# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

FAP FAP — Plateforme de jeu de cartes multijoueur en ligne (jeu camerounais). Deux dépôts GitHub existent ; le dépôt actif est `walisylverdukmer/fapfap` (branche `master`). Le service Render `fap-fap-api` y est connecté et sert à la fois l'API et le frontend statique.

## Commands

```bash
# Développement (depuis le dossier server/)
cd server && npm run dev          # nodemon, rechargement automatique
cd server && npm start            # production locale

# Tests unitaires (pas de framework externe — assert natif Node.js)
cd server && npm test
# ou directement :
node server/tests/game-logic.test.js

# Migrations DB — à exécuter une seule fois contre Neon
node server/run_migration_003.js  # ajoute last_seen_at, club Public
node server/run_migration_004.js  # ajoute notifications + notification_reads

# Génération des icônes PWA (si regénération nécessaire)
node generate-icons.js            # nécessite : npm install canvas (à la racine)
```

**Variables d'environnement requises** (dans `server/.env`) :

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | URL Neon (peut être entourée de guillemets simples — strippés dans `db.js`) |
| `JWT_SECRET` | Obligatoire — `process.exit(1)` au démarrage si absent |
| `CORS_ORIGINS` | Liste séparée par virgules des origines autorisées |
| `RENDER_EXTERNAL_URL` | Injecté automatiquement par Render, ajouté au whitelist CORS |
| `TURN_TIMEOUT_MS` | Délai de tour en ms (défaut : 30000) |

## Architecture

### Flux de données

```
Browser → client/config.js (BACKEND_URL) → Express /api/* + Socket.IO
                                          → express.static(client/)
```

Le serveur Node.js (`server/server.js`) est monolithique : il monte les routes REST, gère tous les événements Socket.IO, et sert le dossier `client/` en statique. Il n'y a pas de build frontend — les fichiers HTML/CSS/JS sont servis tels quels.

`BACKEND_URL` est défini dans `client/config.js` (auto-détecté : `window.location.origin` en prod, `localhost:5000` en dev). Ce fichier doit être chargé en premier dans chaque page HTML avant tout autre script.

### Trois rôles utilisateur

- **`superadmin`** (Wali) — accès total, reçoit toutes les commissions
- **`katika`** — gestionnaire de club, valide les recharges de ses joueurs
- **`player`** — joueur, peut demander des jetons à son Katika

### État du jeu (RAM vs DB)

L'état des parties en cours est conservé **uniquement en RAM** dans l'objet `tables` de `server.js` (clés : `club_X` ou `salon_X`). La DB n'est écrite qu'à la fin d'une partie (`handleGameOver`), lors des mises et des recharges. `table_seats` et `table_observers` sont synchronisés en DB au `sit-at-table` / `leave-table`.

### Socket.IO — Architecture visiteur

Pas de middleware `io.use()` — toutes les connexions Socket.IO aboutissent. L'authentification est optionnelle via l'événement `authenticate` (envoi du JWT après connexion). Les visiteurs anonymes peuvent observer les tables sans token.

`io` et `connectedSockets` (Map userId → socketId) sont stockés sur l'app Express via `app.set()` et récupérés dans les contrôleurs via `req.app.get('io')` et `req.app.get('connectedSockets')`.

### Sécurité frontend

`client/auth-guard.js` doit être le **premier script** dans `<head>` de chaque page protégée (avant `config.js`). Il masque le body immédiatement, vérifie l'expiration du JWT, et gère la restauration bfcache via un listener `pageshow`.

`client/script.js` (page login) contient un IIFE `redirectIfAuthenticated()` qui renvoie immédiatement les utilisateurs déjà connectés vers leur page de destination.

### Schéma DB — Ordre des migrations

```
001_neon_schema.sql   → Tables de base : clubs, users, game_sessions, transactions,
                        audit_logs, recharge_requests. Types ENUM. Triggers financiers.
002_salon.sql         → salon_tables, table_seats, table_observers, v_salon_state.
003_sprint6.sql       → Colonne last_seen_at sur users. Club "Public" (id auto). pin_message.
004_notifications.sql → notifications, notification_reads, v_notifications_unread.
005_ux21.sql          → academy_wallets, academy_transactions. salon_tables enrichi
                        (table_type, currency, academy_level).
006_fap22.sql         → terms_acceptances, withdrawal_requests, platform_settings.
                        Étend l'enum notification_type.
```

**Runners de migration** : toujours exécuter depuis `server/` (pas la racine) pour que dotenv trouve `server/.env`.
```bash
cd server && node run_migration_005.js
cd server && node run_migration_006.js
```

### Services Render

| Service | Repo | Rôle |
|---|---|---|
| `fap-fap-api` | `fapfap / master` ✅ | Backend Node.js + frontend statique — **c'est l'app** |
| `fap-fap-game` | `fapfap-server / main` ❌ | Ancien repo MySQL/Aiven (janvier 2026) — à suspendre |

L'URL de l'application en production est `https://fap-fap-api.onrender.com/`.

### Deck FAP FAP

32 cartes : valeurs 3 à 10 × 4 couleurs (`spade`, `heart`, `club`, `diamond`). Victoires spéciales validées côté serveur : `TCHIA` (somme ≤ 21), `3 SEPT`, `CARRE`, `COULEUR` (flush sans 3), `KORATTE` (flush avec 3, pot × 2).

### Table de jeu — responsivité mobile

`client/game-layout.css` + `client/game-scale.js` gèrent la mise à l'échelle :
- La table native est **900×520px**. `game-scale.js` applique un `CSS transform scale()` pour l'adapter à l'écran.
- **Mobile paysage** : header réduit à 44px, overhangs compressés (ovhT=30, ovhB=105 vs 65+195 en portrait). Gain de ~25% de scale factor.
- **Breakpoint mobile** élargi à 900px (depuis 768px) pour couvrir les tablettes.
- **Modal zoom carte** (`#card-zoom-modal`) : tap sur n'importe quelle `.card-on-table` → affiche la carte en 150×220px plein écran. Tap hors-tour sur `.card-img` en main → zoom aussi.
- **Cartes** : `.cv` = valeur (haut), `.cs` = symbole (bas, retourné 180°) — classe HTML unifiée pour table et main.
- `pz-3` / `pz-4` : maintenant en `flex-direction:column` à l'intérieur de la table (ex-`right:-80px` était hors écran).

### PWA

`client/manifest.json` + `client/sw.js` (Service Worker network-first). SW n'intercepte jamais `/socket.io/` ni `/api/`. Icônes dans `client/icons/` (SVG + PNG 192/512 générés par `generate-icons.js`).

### Dashboard admin (FAP FAP 2.2)

`client/dashboard-pro.html` : navigation à 5 onglets via `showTab(name)`.
- **Aperçu** : stats + retraits Wave + demandes jetons
- **Joueurs** : liste complète filtrée avec actions (suspendre/réactiver/bannir/ajuster solde)
- **Transactions** : historique 300 lignes, filtre type + recherche texte
- **Clubs & Katika** : stats par club + formulaire recrutement Katika
- **Annonces** : CRUD annonces

Routes admin (toutes `requireRole('superadmin')`) :
- `GET /api/admin/users` — liste complète (katika = seulement son club)
- `GET /api/admin/transactions?type=X&limit=N`
- `GET /api/admin/clubs` — stats agrégées
- `PUT /api/admin/users/:id/wallet` — ajustement solde + audit_log
- `PUT /api/admin/users/:id/suspend|unsuspend|ban`
