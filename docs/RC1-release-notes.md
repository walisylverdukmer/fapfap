# FAP FAP — Release Notes v1.0.0-rc1

**Date :** 2026-06-16  
**Tag git :** `v1.0.0-rc1`  
**Commit :** `a6ed598`  
**Statut :** Release Candidate 1 — Bêta fermée autorisée  
**Tests :** 35/35 ✅ (`npm test`)

---

## Périmètre fonctionnel livré

### Moteur de jeu (complet)
- Distribution de 5 cartes par joueur — mélange Fisher-Yates (sans biais)
- Gestion des tours à rotation gauche, dealer tournant
- Plis : carte d'entame → gagnant de la couleur la plus haute
- Règle Passe : blocage de 2 cartes, révélation et comparaison en fin de manche
- Règle Banque : abandon protégé avant 2 cartes jouées dans le pli
- Toutes les victoires spéciales validées côté serveur :
  - TCHIA (somme ≤ 21), 3 SEPT (≥3 cartes de valeur 7)
  - Carré (4 cartes identiques), Couleur (5 même groupe sans 3)
  - KORATTE ×2 (5 même groupe avec 3)
- Victoire automatique KORATTE si dernier pli gagné avec un 3
- Gestion "Tous Banqué" : dernier actif remporte le pot

### Validation serveur des cartes
- Rejet des cartes absentes de la main serveur (log `invalid_card_play`)
- Rejet du non-suivi de couleur quand le joueur possède la couleur d'entame (log `suit_violation`)
- Réponse `card-rejected` avec raison explicite + timer relancé

### Économie
- Prélèvement des mises à chaque partie (vérification solde préalable)
- Commission 5 % Wali prélevée automatiquement sur chaque gain
- Transactions loguées (`mise`, `gain`, `commission`) avec soldes avant/après
- Sessions de jeu enregistrées dans `game_sessions`
- Commissions tracées dans la table `commissions`

### Sécurité
- JWT obligatoire sans fallback — serveur refuse de démarrer si `JWT_SECRET` absent
- Rate limiting login : 10 tentatives / 15 min / IP → HTTP 429
- CORS whitelist env-driven (Express + Socket.IO)
- Validation serveur de toutes les victoires spéciales
- Auto-suspension après 3 fraudes (`claim_fraud` persisté en `audit_logs`)
- Vérification statut compte à la connexion HTTP et au `join-table` Socket.IO
- Vérification périodique des statuts toutes les 60 secondes (kick immédiat si suspendu)
- Gestion des déconnexions en cours de partie : auto-fold + continuation

### Résilience
- Timer de tour configurable (défaut 30 s) : auto-banque si AFK
- Déconnexion mid-partie : auto-fold, ajustement des indices, partie continue
- Mise à jour `turnTimer` annulée si le tour a déjà avancé (race condition couverte)

### Administration
- `GET /api/admin/users` — liste filtrée par rôle (Wali : tous, Katika : son club)
- `PUT /api/admin/users/:id/suspend` — suspension temporaire + déconnexion immédiate
- `PUT /api/admin/users/:id/unsuspend` — réactivation
- `PUT /api/admin/users/:id/ban` — bannissement définitif (Wali uniquement)
- `GET /api/admin/sanctions` — historique des sanctions depuis `audit_logs`

### Infrastructure
- PostgreSQL Neon (cloud) — `DATABASE_URL` configurable
- Pool de connexions (max 10, timeout 5 s)
- Socket.IO 4, Express 5, Node.js ≥18
- `npm test` → 35 tests unitaires, runner natif Node.js

---

## Fichiers livrés (58 fichiers, hors node_modules et .env)

```
.gitignore
client/                    ← Interface HTML/JS/CSS (10 fichiers)
docs/                      ← 19 fichiers de documentation et rapports
server/
  config/db.js             ← Pool PostgreSQL
  controllers/             ← auth, money, admin (recharge = stub)
  middleware/              ← authMiddleware, requireRole
  migrations/              ← 001_neon_schema.sql
  routes/                  ← auth, money, admin
  tests/game-logic.test.js ← 35 tests unitaires
  server.js                ← Point d'entrée (873 lignes)
  package.json             ← scripts: test, start, dev
```

---

## Checklist de déploiement bêta

### Pré-déploiement
- [ ] Renseigner toutes les variables d'environnement (voir `vercel-deployment-guide.md`)
- [ ] `JWT_SECRET` généré avec `openssl rand -hex 64` (≥128 bits)
- [ ] `DATABASE_URL` Neon vérifié et accessible
- [ ] `CORS_ORIGINS` contient l'URL exacte du client déployé
- [ ] `NODE_ENV=production`
- [ ] `npm test` → 35/35 ✅ (depuis `server/`)

### Déploiement
- [ ] Déployer le backend (`server/`) sur Vercel / Railway / Render
- [ ] Vérifier les logs de démarrage : `🚀 Serveur Fap Fap 2026 opérationnel sur port X`
- [ ] Aucun message `[FATAL]` dans les logs

### Post-déploiement
- [ ] `POST /api/auth/login` avec compte Wali → token JWT valide
- [ ] `GET /api/admin/users` → liste des utilisateurs
- [ ] Ouvrir `client/index.html` pointant sur l'URL du backend
- [ ] Rejoindre une table → wallet visible
- [ ] Lancer une partie à 2 joueurs → cartes distribuées, tours fonctionnels
- [ ] Tenter une victoire TCHIA → validée ou rejetée correctement

### Go / No-Go bêta fermée
- [ ] Tous les checks ci-dessus passent
- [ ] Au moins 1 Katika créé avec un club
- [ ] Joueurs rechargés via `POST /api/money/transfer` (Katika → Joueur)
- [ ] Wali informé de l'URL de l'interface admin (`dashboard-pro.html`)

---

## Ce qui N'EST PAS dans cette RC

Voir `docs/known-limitations.md` pour la liste complète.
