# 08 — Feuille de Route — Évolution des Tâches

> Date : 2026-06-15  
> Légende : 🔴 Bloquant | 🟠 Important | 🟡 Utile | 🔵 Optionnel | ✅ Fait | 🔄 En cours | ⬜ À faire

---

## PHASE 0 — Corrections urgentes (Semaine 1)

Ces tâches doivent être faites avant toute mise en production ou partage du projet.

| ID | Priorité | Tâche | Fichiers | Durée | Statut |
|----|---------|-------|---------|-------|--------|
| T-01 | 🔴 | Corriger l'exploit claim-special-victory (validation serveur) | `server.js` | 2h | ⬜ |
| T-02 | 🔴 | Changer le JWT secret + ajouter `.env` dans `.gitignore` | `.env`, `.gitignore` | 30min | ⬜ |
| T-03 | 🔴 | Ajouter vérification de rôle sur `/api/money/transfer` | `moneyController.js` | 1h | ⬜ |
| T-04 | 🔴 | Corriger le bug `cardsPlayedInRound` (jamais incrémenté) | `server.js` | 30min | ⬜ |
| T-05 | 🟠 | Ajouter rate limiting sur `/api/auth/login` | `authRoutes.js` | 30min | ⬜ |
| T-06 | 🟠 | Remplacer les requêtes `WHERE username` par `WHERE id` | `server.js`, controllers | 2h | ⬜ |
| T-07 | 🟠 | Masquer les mains dans `player-list-update` | `server.js` | 1h | ⬜ |

---

## PHASE 1 — Base de données (Semaine 2)

Créer un fichier de migration SQL propre et migrer la base.

| ID | Priorité | Tâche | Fichiers | Durée | Statut |
|----|---------|-------|---------|-------|--------|
| T-08 | 🔴 | Créer le fichier de migration SQL initial | `server/migrations/001_initial.sql` | 3h | ⬜ |
| T-09 | 🔴 | Ajouter `status`, `last_login`, `updated_at` à `users` | migration | 30min | ⬜ |
| T-10 | 🔴 | Ajouter `stake_default`, `commission_rate`, `status` à `clubs` | migration | 30min | ⬜ |
| T-11 | 🔴 | Ajouter `balance_before`, `balance_after`, `status` à `transactions` | migration | 30min | ⬜ |
| T-12 | 🟠 | Créer la table `game_sessions` | migration | 1h | ⬜ |
| T-13 | 🟠 | Créer la table `game_players` | migration | 1h | ⬜ |
| T-14 | 🟡 | Créer la table `game_rounds` | migration | 1h | ⬜ |
| T-15 | 🟡 | Créer la table `commissions` | migration | 1h | ⬜ |
| T-16 | 🟡 | Créer la table `recharge_requests` | migration | 1h | ⬜ |
| T-17 | 🔵 | Créer la table `audit_logs` | migration | 1h | ⬜ |
| T-18 | 🟠 | Ajouter tous les index manquants | migration | 30min | ⬜ |
| T-19 | 🟠 | Ajouter la contrainte CHECK `wallet >= 0` | migration | 15min | ⬜ |

---

## PHASE 2 — Persistence du jeu (Semaine 3)

Brancher la logique de jeu sur la base de données pour l'historisation.

| ID | Priorité | Tâche | Fichiers | Durée | Statut |
|----|---------|-------|---------|-------|--------|
| T-20 | 🔴 | Créer une `game_session` en DB au `start-game` | `server.js` | 3h | ⬜ |
| T-21 | 🔴 | Enregistrer les `game_players` avec `cards_dealt` | `server.js` | 2h | ⬜ |
| T-22 | 🔴 | Enregistrer `balance_before`/`balance_after` dans `transactions` | `server.js`, `moneyController.js` | 2h | ⬜ |
| T-23 | 🔴 | Mettre à jour `game_sessions.status` = 'finished' en fin de partie | `server.js` | 1h | ⬜ |
| T-24 | 🟠 | Implémenter le remboursement automatique si crash en cours de partie | `server.js` | 3h | ⬜ |
| T-25 | 🟠 | Enregistrer chaque pli dans `game_rounds` | `server.js` | 2h | ⬜ |
| T-26 | 🟡 | Calculer et insérer les commissions dans `commissions` | `server.js` | 2h | ⬜ |
| T-27 | 🟡 | Nettoyage périodique des tables inactives (setInterval) | `server.js` | 1h | ⬜ |

---

## PHASE 3 — Refactoring architecture (Semaine 4)

Remettre le code dans une architecture propre.

| ID | Priorité | Tâche | Fichiers | Durée | Statut |
|----|---------|-------|---------|-------|--------|
| T-28 | 🟠 | Déplacer toute la logique Socket.IO vers `sockets/gameManager.js` | `server.js`, `gameManager.js` | 4h | ⬜ |
| T-29 | 🟠 | Implémenter la logique des routes dans `gameRoutes.js` / `gameController.js` | `gameRoutes.js`, `gameController.js` | 2h | ⬜ |
| T-30 | 🟠 | Grouper les requêtes SQL du `start-game` en transaction atomique | `server.js` | 2h | ⬜ |
| T-31 | 🟡 | Déplacer les `setTimeout` (800ms) côté client | `server.js`, `game.js` | 1h | ⬜ |
| T-32 | 🟡 | Centraliser la validation des entrées (Joi/Zod) | `authController.js`, `moneyController.js` | 3h | ⬜ |
| T-33 | 🟡 | Valider le suivi de couleur obligatoire côté serveur | `server.js` | 1h | ⬜ |
| T-34 | 🟡 | Mettre à jour `users.last_login` à chaque connexion | `authController.js` | 30min | ⬜ |

---

## PHASE 4 — Sécurité avancée (Semaine 5)

| ID | Priorité | Tâche | Fichiers | Durée | Statut |
|----|---------|-------|---------|-------|--------|
| T-35 | 🟠 | CORS restrictif (liste blanche d'origines) | `server.js` | 30min | ⬜ |
| T-36 | 🟠 | Retirer les mots de passe en dur du code source | `init_db.js`, `seed.js`, `reset_wali.js` | 30min | ⬜ |
| T-37 | 🟡 | Ajouter Content Security Policy (CSP headers) | `server.js` | 1h | ⬜ |
| T-38 | 🟡 | Implémenter la révocation de tokens (blacklist Redis ou refresh tokens) | `authMiddleware.js` | 4h | ⬜ |
| T-39 | 🔵 | Migrer le stockage du JWT de localStorage vers cookie HttpOnly | `script.js`, `authController.js` | 4h | ⬜ |
| T-40 | 🔵 | Ajouter HTTPS (certificat TLS via NGINX/Caddy) | Infrastructure | 2h | ⬜ |

---

## PHASE 5 — Fonctionnalités manquantes (Semaine 6+)

| ID | Priorité | Tâche | Description | Statut |
|----|---------|-------|-------------|--------|
| T-41 | 🟠 | Workflow recharge requests | Implémenter `/api/money/recharge` (actuellement stub) | ⬜ |
| T-42 | 🟠 | Dashboard commissions Wali | Afficher les commissions dues et perçues | ⬜ |
| T-43 | 🟡 | Historique des parties joueur | Vue par joueur de toutes ses parties | ⬜ |
| T-44 | 🟡 | Statistiques club (Katika) | Volume, gains, joueurs actifs | ⬜ |
| T-45 | 🟡 | Implémenter `player-view.html` | Page spectateur actuellement vide | ⬜ |
| T-46 | 🟡 | Suspension de compte | `users.status = 'suspended'` | ⬜ |
| T-47 | 🟡 | Configuration mise par club | Utiliser `clubs.stake_default` | ⬜ |
| T-48 | 🔵 | Stocker avatar en DB | `users.avatar_url` pour éviter DiceBear à chaque connexion | ⬜ |
| T-49 | 🔵 | Statistiques joueur (winrate, FCFA gagné/perdu) | Analytics | ⬜ |
| T-50 | 🔵 | Export CSV des transactions | Pour le Wali | ⬜ |

---

## Métriques de progression

```
Phase 0 (Urgences)     : [          ] 0/7   tâches complétées
Phase 1 (Base données) : [          ] 0/12  tâches complétées
Phase 2 (Persistence)  : [          ] 0/8   tâches complétées
Phase 3 (Refactoring)  : [          ] 0/7   tâches complétées
Phase 4 (Sécurité)     : [          ] 0/6   tâches complétées
Phase 5 (Features)     : [          ] 0/10  tâches complétées
─────────────────────────────────────────────────────────────
Total                  : [          ] 0/50  tâches complétées
```

---

## Notes de mise à jour

| Date | Tâche | Action | Par |
|------|-------|--------|-----|
| 2026-06-15 | — | Analyse initiale du projet | Claude |

*Mettre à jour ce tableau à chaque tâche complétée.*
