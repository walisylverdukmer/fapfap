# Rapport de Migration — Neon PostgreSQL

> Date d'exécution : 2026-06-15  
> Statut : **COMPLÉTÉ — Base de données opérationnelle**

---

## 1. Connexion

| Paramètre | Valeur |
|---|---|
| Provider | Neon Cloud (serverless PostgreSQL) |
| Région | `eu-west-2` (Londres, AWS) |
| Endpoint | `ep-jolly-flower-abxamf9t-pooler.eu-west-2.aws.neon.tech` |
| Base de données | `neondb` |
| Utilisateur | `neondb_owner` |
| PostgreSQL | **18.4** |
| SSL | `require` |
| Taille avant migration | 7 536 kB (base vide) |
| Variable d'environnement | `DATABASE_URL` dans `server/.env` |

---

## 2. Tables créées (9)

| Table | Colonnes | Lignes | Rôle |
|---|---|---|---|
| `users` | 11 | 0 | Wali, Katikas, Players |
| `clubs` | 9 | 0 | Clubs de jeu |
| `game_sessions` | 13 | 0 | Historique des parties |
| `game_players` | 9 | 0 | Joueurs par partie |
| `game_rounds` | 7 | 0 | Plis par partie |
| `transactions` | 12 | 0 | Ledger financier |
| `commissions` | 11 | 0 | Commissions Wali |
| `recharge_requests` | 9 | 0 | Demandes de recharge |
| `audit_logs` | 10 | 0 | Journal d'audit |

---

## 3. Types ENUM créés (10)

| Type | Valeurs |
|---|---|
| `user_role` | superadmin, katika, player |
| `user_status` | active, suspended, inactive |
| `club_status` | open, closed, suspended |
| `transaction_type` | mise, gain, transfert, recharge, commission, remboursement |
| `transaction_status` | pending, confirmed, cancelled |
| `game_status` | waiting, playing, finished, cancelled |
| `win_type` | normal, koratte, carre, tchia, trois_sept, couleur, tous_banque |
| `player_result` | winner, loser, banque, spectator |
| `commission_status` | pending, paid, disputed |
| `recharge_status` | pending, approved, rejected |

---

## 4. Clés étrangères créées (22)

### Graphe de dépendances

```
users ←────────────────────────────────────────────────────┐
  ↑                                                         │
  │ (katika_id)                                             │
clubs ←──────────────────────────────────────────────────┐  │
  ↑                                                       │  │
  │ (club_id)                                             │  │
game_sessions ←──────────────────────────────────────┐   │  │
  ↑         ↑                                         │   │  │
  │         │ (game_session_id)                       │   │  │
game_players  game_rounds                             │   │  │
                                                      │   │  │
transactions ─────────────────────────────────────────┘   │  │
commissions ──────────────────────────────────────────────┘  │
recharge_requests ────────────────────────────────────────────┘
audit_logs ────────────────────────────────────────────────────┘
```

### Liste complète

| Contrainte | Table.Colonne | Référence | ON DELETE |
|---|---|---|---|
| `fk_users_club` | `users.club_id` | `clubs.id` | SET NULL |
| `fk_clubs_katika` | `clubs.katika_id` | `users.id` | — |
| `fk_gs_club` | `game_sessions.club_id` | `clubs.id` | — |
| `fk_gs_dealer` | `game_sessions.dealer_id` | `users.id` | — |
| `fk_gs_winner` | `game_sessions.winner_id` | `users.id` | — |
| `fk_gp_session` | `game_players.game_session_id` | `game_sessions.id` | — |
| `fk_gp_user` | `game_players.user_id` | `users.id` | — |
| `fk_gr_session` | `game_rounds.game_session_id` | `game_sessions.id` | — |
| `fk_gr_leader` | `game_rounds.leader_id` | `users.id` | — |
| `fk_gr_winner` | `game_rounds.winner_id` | `users.id` | — |
| `fk_tx_user` | `transactions.user_id` | `users.id` | — |
| `fk_tx_club` | `transactions.club_id` | `clubs.id` | — |
| `fk_tx_session` | `transactions.game_session_id` | `game_sessions.id` | SET NULL |
| `fk_tx_sender` | `transactions.sender_id` | `users.id` | — |
| `fk_com_session` | `commissions.game_session_id` | `game_sessions.id` | — |
| `fk_com_club` | `commissions.club_id` | `clubs.id` | — |
| `fk_com_wali` | `commissions.wali_id` | `users.id` | — |
| `fk_com_katika` | `commissions.katika_id` | `users.id` | — |
| `fk_rr_requester` | `recharge_requests.requester_id` | `users.id` | — |
| `fk_rr_target` | `recharge_requests.target_id` | `users.id` | — |
| `fk_rr_reviewer` | `recharge_requests.reviewed_by` | `users.id` | — |
| `fk_al_user` | `audit_logs.user_id` | `users.id` | SET NULL |

---

## 5. Index créés (34)

| Nom | Table | Colonnes | Type |
|---|---|---|---|
| `uq_users_phone` | users | phone | UNIQUE |
| `idx_users_phone` | users | phone | B-tree |
| `idx_users_club_id` | users | club_id | B-tree |
| `idx_users_role` | users | role | B-tree |
| `idx_users_status` | users | status | B-tree |
| `idx_clubs_katika_id` | clubs | katika_id | B-tree |
| `idx_clubs_status` | clubs | status | B-tree |
| `idx_gs_club_id` | game_sessions | club_id | B-tree |
| `idx_gs_dealer_id` | game_sessions | dealer_id | B-tree |
| `idx_gs_winner_id` | game_sessions | winner_id | B-tree |
| `idx_gs_status` | game_sessions | status | B-tree |
| `idx_gs_created_at` | game_sessions | created_at DESC | B-tree |
| `uq_session_player` | game_players | (game_session_id, user_id) | UNIQUE |
| `idx_gp_session_id` | game_players | game_session_id | B-tree |
| `idx_gp_user_id` | game_players | user_id | B-tree |
| `idx_gp_result` | game_players | result | B-tree |
| `uq_gr_round` | game_rounds | (game_session_id, round_number) | UNIQUE |
| `idx_gr_session_id` | game_rounds | game_session_id | B-tree |
| `idx_tx_user_id` | transactions | user_id | B-tree |
| `idx_tx_club_id` | transactions | club_id | B-tree |
| `idx_tx_session_id` | transactions | game_session_id | B-tree |
| `idx_tx_created_at` | transactions | created_at DESC | B-tree |
| `idx_tx_type` | transactions | type | B-tree |
| `idx_tx_status` | transactions | status | B-tree |
| `idx_com_session_id` | commissions | game_session_id | B-tree |
| `idx_com_wali_id` | commissions | wali_id | B-tree |
| `idx_com_status` | commissions | status | B-tree |
| `idx_rr_requester` | recharge_requests | requester_id | B-tree |
| `idx_rr_target` | recharge_requests | target_id | B-tree |
| `idx_rr_status` | recharge_requests | status | B-tree |
| `idx_al_user_id` | audit_logs | user_id | B-tree |
| `idx_al_action` | audit_logs | action | B-tree |
| `idx_al_created_at` | audit_logs | created_at DESC | B-tree |
| `idx_al_entity` | audit_logs | (entity_type, entity_id) | B-tree composite |

---

## 6. Contraintes métier CHECK (15)

| Contrainte | Table | Règle métier |
|---|---|---|
| `chk_users_wallet` | users | Solde wallet toujours ≥ 0 |
| `chk_clubs_stake` | clubs | Mise par défaut > 0 FCFA |
| `chk_clubs_players` | clubs | 2 ≤ max_players ≤ 8 |
| `chk_clubs_commission` | clubs | 0 ≤ taux commission ≤ 100% |
| `chk_gs_stake` | game_sessions | Mise de partie > 0 |
| `chk_gs_players` | game_sessions | 2 ≤ joueurs ≤ 8 |
| `chk_gs_commission` | game_sessions | Commission ≥ 0 |
| `chk_gp_stake` | game_players | Mise payée > 0 |
| `chk_gp_gain` | game_players | Gain reçu ≥ 0 |
| `chk_gr_round` | game_rounds | Numéro de pli ≥ 1 |
| `chk_tx_amount` | transactions | Montant ≠ 0 (jamais nul) |
| `chk_tx_balance` | transactions | Solde après opération ≥ 0 |
| `chk_com_amount` | commissions | Commission > 0 |
| `chk_com_rate` | commissions | 0 < taux ≤ 100% |
| `chk_rr_amount` | recharge_requests | Montant demandé > 0 |

---

## 7. Triggers créés (2)

| Trigger | Table | Événement | Fonction |
|---|---|---|---|
| `trg_users_updated_at` | users | BEFORE UPDATE | `set_updated_at()` |
| `trg_clubs_updated_at` | clubs | BEFORE UPDATE | `set_updated_at()` |

**Fonction `set_updated_at()` :** Met à jour automatiquement `updated_at = NOW()` à chaque UPDATE. Équivalent PostgreSQL du `ON UPDATE CURRENT_TIMESTAMP` MySQL.

---

## 8. Améliorations apportées vs schéma MySQL original

### Tables ajoutées (6 nouvelles)

| Table | Problème résolu |
|---|---|
| `game_sessions` | État des parties était en RAM → crash = mises perdues sans remboursement |
| `game_players` | Aucune liaison persistante partie ↔ joueur |
| `game_rounds` | Aucun historique des plis — litiges irresolubles |
| `commissions` | Prélèvement Wali inexistant malgré `commission_rate` prévu |
| `recharge_requests` | Endpoint `/api/money/recharge` retournait un stub vide |
| `audit_logs` | Traçabilité nulle — actions admin non enregistrées |

### Colonnes ajoutées sur tables existantes

| Table | Colonne | Raison |
|---|---|---|
| `users` | `status` | Suspension sans suppression |
| `users` | `last_login` | Sécurité + analytics |
| `users` | `updated_at` | Traçabilité des modifications |
| `clubs` | `stake_default` | Était hardcodé à 500 dans server.js |
| `clubs` | `max_players` | Était hardcodé à 4 dans server.js |
| `clubs` | `commission_rate` | Logique de commission prévue mais non implémentée |
| `clubs` | `status` | Fermeture/suspension de club |
| `clubs` | `updated_at` | Traçabilité |
| `transactions` | `game_session_id` | Lien partie → transaction |
| `transactions` | `balance_before` | Audit sans recalcul complet |
| `transactions` | `balance_after` | Reconstitution d'historique wallet |
| `transactions` | `status` | Gestion pending (recharges) |
| `transactions` | `note` | Commentaire admin |

### Types de transactions ajoutés

| Type | Usage |
|---|---|
| `recharge` | Chargement wallet via recharge_requests |
| `commission` | Prélèvement automatique Wali |
| `remboursement` | Retour de mises en cas de crash/annulation |

---

## 9. Résultat de l'exécution

| Étape | Éléments | Résultat |
|---|---|---|
| Types ENUM | 10 | ✅ 10/10 OK |
| Fonction trigger | 1 | ✅ 1/1 OK |
| Tables | 10 (9 + 1 ALTER FK) | ✅ 10/10 OK |
| Triggers | 2 | ✅ 2/2 OK |
| Index | 30 | ✅ 30/30 OK |
| **TOTAL** | **53 statements** | **✅ 53/53 OK** |

---

## 10. Recommandations — Prochaines étapes

### Priorité 1 — Migration du code (mysql2 → pg)

Le backend utilise encore `mysql2`. La migration du code est la prochaine étape. Fichiers à modifier :

| Fichier | Changements requis |
|---|---|
| `server/config/db.js` | Remplacer mysql2 pool par pg Pool + DATABASE_URL |
| `server/server.js` | 10+ requêtes : `?` → `$1,$2`, `[rows]` → `{rows}` |
| `server/controllers/authController.js` | 7 requêtes + `insertId` → `RETURNING id` |
| `server/controllers/moneyController.js` | 5 requêtes |
| `package.json` | Désinstaller `mysql2`, installer `pg` |

### Priorité 2 — Persistance des parties

Intégrer les INSERTs dans `game_sessions`, `game_players`, `game_rounds` dans `server.js` lors des événements Socket.IO (`start-game`, `card-played`, `handleGameOver`).

### Priorité 3 — Commissions automatiques

Ajouter dans `handleGameOver()` :
```js
// Calcul commission
const commission = pot * club.commission_rate;
// INSERT INTO commissions ...
// INSERT INTO transactions (type='commission', user_id=wali_id, amount=commission)
```

### Priorité 4 — Seed de données initiales

Créer le compte Wali Sylver et données de test :
```sql
INSERT INTO users (username, phone, password, role, wallet, status)
VALUES ('Wali Sylver', '0700000001', '<bcrypt>', 'superadmin', 1000000, 'active');
```

### Priorité 5 — Sécurité

- Corriger le bug `claim-special-victory` (validation serveur des mains)
- Ajouter les INSERTs dans `audit_logs` aux endpoints sensibles (login, transfert, création Katika)
- Changer `JWT_SECRET` — la valeur actuelle dans `.env` doit être plus robuste (32+ chars aléatoires)

---

## 11. Variables d'environnement après migration complète

```env
# server/.env — état cible après migration mysql2 → pg

PORT=5000

# PostgreSQL Neon (remplace les 4 variables MySQL)
DATABASE_URL='postgresql://neondb_owner:<password>@ep-jolly-flower-abxamf9t-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require'

# Auth
JWT_SECRET=<32_caractères_aléatoires_minimum>

# Variables MySQL à supprimer après migration complète :
# DB_HOST, DB_USER, DB_PASS, DB_NAME
```

---

*Rapport généré le 2026-06-15 — Schéma vérifiable via Neon Console → Tables*
