# 01 — Analyse Globale du Projet FAP FAP

> Date : 2026-06-15

---

## 1. Description du projet

FAP FAP est une **plateforme de jeu de cartes en ligne multijoueur** permettant à des joueurs répartis dans des clubs de jouer en temps réel. Le jeu est un jeu de plis avec des règles spécifiques (PASS, BANQUE, KORATTE, CARRÉ, etc.).

---

## 2. Architecture générale

```
┌─────────────────────────────────────────────────────────┐
│                     CLIENT (Browser)                    │
│  index.html / dashboard.html / game.html / ...          │
│  Vanilla JS + Socket.IO Client + Fetch API              │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTP REST + WebSocket
┌───────────────────────▼─────────────────────────────────┐
│                  SERVEUR (Node.js 5000)                  │
│  Express 5 (REST API) + Socket.IO (temps réel)          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  authRoutes  │  │ moneyRoutes  │  │  gameRoutes   │  │
│  │              │  │              │  │  (VIDE)       │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              server.js (Socket.IO Logic)            │ │
│  │  tables{} : état en mémoire RAM de toutes les tables│ │
│  └─────────────────────────────────────────────────────┘ │
└───────────────────────┬─────────────────────────────────┘
                        │ mysql2 pool
┌───────────────────────▼─────────────────────────────────┐
│                  MySQL (fap_fap_db)                      │
│  users | clubs | transactions                            │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Stack technique réelle

| Composant | Technologie | Version |
|-----------|-------------|---------|
| Runtime | Node.js | LTS |
| Framework HTTP | Express | ^5.2.1 |
| Temps réel | Socket.IO | ^4.8.3 |
| Base de données | MySQL | local |
| Driver BD | mysql2 | ^3.16.0 |
| Auth | jsonwebtoken | ^9.0.3 |
| Hachage | bcryptjs | ^3.0.3 |
| CORS | cors | ^2.8.5 |
| Env | dotenv | ^17.2.3 |
| Dev | nodemon | ^3.1.11 |
| Frontend | Vanilla JS | — |
| Avatars | DiceBear API | v7 (externe) |

**⚠️ IMPORTANT — Pas de Supabase :** Contrairement au titre de l'analyse demandée, le projet n'a **aucune dépendance Supabase**. Il utilise MySQL local via `mysql2`.

---

## 4. Hiérarchie des utilisateurs

```
┌─────────────────────────────────────────────┐
│          WALI (Superadmin)                  │
│  • Crée les Katikas                         │
│  • Recharge les Katikas (transfert direct)  │
│  • Wallet illimité (pas de contrôle débit)  │
│  • Accès à dashboard-pro.html               │
└──────────────────┬──────────────────────────┘
                   │ crée
┌──────────────────▼──────────────────────────┐
│          KATIKA (Club Manager)              │
│  • Gère un seul club                        │
│  • Enregistre et finance les joueurs        │
│  • Accès à club-manage.html                 │
└──────────────────┬──────────────────────────┘
                   │ enregistre
┌──────────────────▼──────────────────────────┐
│          PLAYER (Joueur)                    │
│  • Appartient à un club                     │
│  • Joue les parties, mise sur les tables    │
│  • Accès à game.html                        │
└─────────────────────────────────────────────┘
                   +
┌─────────────────────────────────────────────┐
│          SPECTATEUR (free, non-logué)       │
│  • player-view.html (accès libre)           │
└─────────────────────────────────────────────┘
```

---

## 5. Fichiers vides (dette technique immédiate)

| Fichier | Statut | Impact |
|---------|--------|--------|
| `server/routes/gameRoutes.js` | VIDE | La logique jeu est dans `server.js` (anti-pattern) |
| `server/controllers/gameController.js` | VIDE | Idem |
| `server/sockets/gameManager.js` | VIDE | Le gameManager aurait dû centraliser les sockets |

---

## 6. Flux de données principaux

### Flux d'authentification
```
Client → POST /api/auth/login (phone + password)
       ← JWT token + user{id, role, club_id, username, wallet}
       → Stocké en localStorage
```

### Flux de jeu (Socket.IO)
```
Client → join-table {club_id, username, stake}
       ← player-list-update, wallet-update, update-dealer

Dealer → start-game {club_id}
       ← receive-cards {hand[], turn}
       ← game-started {pot, activePlayer, activePlayerId, dealerId}

Player → card-played {card, club_id}
       ← display-card, next-turn
       ← game-over {winnerId, potAmount, reason}
```

### Flux financier
```
Wali → POST /api/money/transfer {receiver_id, amount}
     ← success (DB: UPDATE users wallet + INSERT transactions)

Game → Socket.IO start-game
     ← DB: UPDATE users wallet -= stake (pour chaque joueur)
        DB: INSERT transactions type='mise'

Game → handleGameOver()
     ← DB: UPDATE users wallet += pot (gagnant)
        DB: INSERT transactions type='gain'
```

---

## 7. Couverture fonctionnelle

| Fonctionnalité | Implémentée | Notes |
|----------------|-------------|-------|
| Login | ✅ Oui | JWT 24h |
| Création Katika | ✅ Oui | Via dashboard-pro |
| Création Joueur | ✅ Oui | Via club-manage |
| Recharge Katika | ✅ Oui | Via transfert direct |
| Recharge Joueur | ✅ Oui | Via transfert |
| Jeu temps réel | ✅ Oui | Socket.IO |
| Gestion du pot | ✅ Oui | En mémoire + DB win |
| PASS | ✅ Oui | 2 cartes verrouillées |
| BANQUE | ✅ Oui | Fold |
| KORATTE | ✅ Partiel | Bonus ×2 déclaré par client |
| CARRÉ / TCHIA | ⚠️ Partiel | Déclaré par client (non vérifié serveur) |
| Spectateur | ⚠️ Partiel | player-view.html vide |
| Historique parties | ❌ Non | Pas de table game_sessions |
| Commission Wali | ❌ Non | Pas de logique de commission |
| Limite de table | ⚠️ Partiel | Max 4 joueurs (en mémoire) |
| Déconnexion propre | ✅ Oui | handleDeparture() |
| Remboursement crash | ❌ Non | Si serveur crash, mises perdues |
