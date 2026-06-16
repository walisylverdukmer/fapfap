# Architecture de Base de Données — FAP FAP

> Base : `neondb` — Neon Cloud PostgreSQL 18.4 — eu-west-2  
> Date : 2026-06-15  
> Statut : **Déployée et vérifiée**

---

## Vue d'ensemble

| Métrique | Valeur |
|---|---|
| Moteur | PostgreSQL 18.4 |
| Provider | Neon Cloud (serverless) |
| Tables | 9 |
| Types ENUM | 10 |
| Clés étrangères | 22 |
| Index | 34 (dont 4 UNIQUE implicites) |
| Contraintes CHECK | 15 métier + 67 NOT NULL auto |
| Triggers | 2 (updated_at automatique) |
| Séquences | 9 (une par table) |

---

## Diagramme relationnel

```
┌─────────────────────────────────────────────────────────┐
│                         USERS                           │
│  id · username · phone(UNIQUE) · password · role        │
│  wallet · club_id · status · last_login                 │
│  created_at · updated_at                                │
└───┬──────────────────────────┬──────────────────────────┘
    │ katika_id                │ club_id (circulaire)
    ▼                          ▼
┌───────────────────┐    ┌─────────────────────────────────┐
│      CLUBS        │    │    (résolu par ALTER TABLE)     │
│  id · name        │◄───┘                                 │
│  katika_id        │                                      │
│  stake_default    │                                      │
│  max_players      │                                      │
│  commission_rate  │                                      │
│  status           │                                      │
└────────┬──────────┘
         │ club_id
         ▼
┌────────────────────────────────────────┐
│             GAME_SESSIONS              │
│  id · club_id · dealer_id · winner_id  │
│  stake · pot_total · commission        │
│  win_type · nb_players · status        │
│  started_at · finished_at             │
└──────┬──────────────────┬─────────────┘
       │ game_session_id  │ game_session_id
       ▼                  ▼
┌──────────────┐  ┌───────────────────────────┐
│ GAME_ROUNDS  │  │       GAME_PLAYERS        │
│  id          │  │  id · game_session_id     │
│  session_id  │  │  user_id · stake_paid     │
│  round_number│  │  gain_received · result   │
│  leader_id   │  │  cards_dealt (JSONB)      │
│  winner_id   │  │  final_cards (JSONB)      │
│  cards_played│  └───────────────────────────┘
│  (JSONB)     │
└──────────────┘

┌───────────────────────────────────────────┐
│               TRANSACTIONS                │
│  id · user_id · club_id                  │
│  game_session_id · sender_id             │
│  amount · balance_before · balance_after  │
│  type · status · note                    │
└───────────────────────────────────────────┘

┌───────────────────────────────────────────┐
│               COMMISSIONS                 │
│  id · game_session_id · club_id           │
│  wali_id · katika_id                     │
│  pot_total · rate · amount               │
│  status · paid_at                        │
└───────────────────────────────────────────┘

┌───────────────────────────────────────────┐
│            RECHARGE_REQUESTS              │
│  id · requester_id · target_id           │
│  amount · status                         │
│  reviewed_by · reviewed_at · note        │
└───────────────────────────────────────────┘

┌───────────────────────────────────────────┐
│               AUDIT_LOGS                 │
│  id (BIGSERIAL) · user_id                │
│  action · entity_type · entity_id        │
│  old_value (JSONB) · new_value (JSONB)   │
│  ip_address (INET) · user_agent          │
└───────────────────────────────────────────┘
```

---

## Détail des tables

### `users`

Utilisateurs du système. Trois rôles hiérarchiques.

| Colonne | Type | Contrainte | Description |
|---|---|---|---|
| `id` | SERIAL | PK | Auto-incrément |
| `username` | VARCHAR(100) | NOT NULL | Pseudo (non unique — deux clubs peuvent avoir le même) |
| `phone` | VARCHAR(20) | UNIQUE NOT NULL | Identifiant de connexion |
| `password` | VARCHAR(255) | NOT NULL | Hash bcrypt |
| `role` | user_role ENUM | NOT NULL DEFAULT 'player' | superadmin / katika / player |
| `wallet` | NUMERIC(15,2) | NOT NULL ≥ 0 | Solde en FCFA |
| `club_id` | INTEGER | FK → clubs.id | NULL pour Wali |
| `status` | user_status ENUM | NOT NULL DEFAULT 'active' | active / suspended / inactive |
| `last_login` | TIMESTAMPTZ | NULL | Mise à jour au login |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | — |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Auto-mis à jour par trigger |

**Index :** `phone`, `club_id`, `role`, `status`  
**Trigger :** `trg_users_updated_at` (BEFORE UPDATE)

---

### `clubs`

Clubs de jeu, chacun géré par un Katika.

| Colonne | Type | Contrainte | Description |
|---|---|---|---|
| `id` | SERIAL | PK | — |
| `name` | VARCHAR(100) | NOT NULL | Nom du club |
| `katika_id` | INTEGER | FK → users.id NOT NULL | Gestionnaire du club |
| `stake_default` | NUMERIC(10,2) | NOT NULL DEFAULT 500 > 0 | Mise par défaut (FCFA) |
| `max_players` | SMALLINT | NOT NULL DEFAULT 4, 2–8 | Joueurs max par table |
| `commission_rate` | NUMERIC(5,4) | NOT NULL DEFAULT 0.05, 0–1 | Taux commission Wali |
| `status` | club_status ENUM | NOT NULL DEFAULT 'open' | open / closed / suspended |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | — |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Auto-mis à jour par trigger |

**Index :** `katika_id`, `status`  
**Trigger :** `trg_clubs_updated_at` (BEFORE UPDATE)

---

### `game_sessions`

Historique de chaque partie jouée. Table centrale pour l'analytics.

| Colonne | Type | Contrainte | Description |
|---|---|---|---|
| `id` | SERIAL | PK | — |
| `club_id` | INTEGER | FK → clubs.id NOT NULL | Club où la partie a eu lieu |
| `dealer_id` | INTEGER | FK → users.id NOT NULL | Dealer (distributeur) |
| `winner_id` | INTEGER | FK → users.id NULL | NULL en cours de partie |
| `stake` | NUMERIC(10,2) | NOT NULL > 0 | Mise de la partie |
| `pot_total` | NUMERIC(15,2) | NOT NULL DEFAULT 0 | Pot (doublé si KORATTE) |
| `commission` | NUMERIC(15,2) | NOT NULL DEFAULT 0 ≥ 0 | Commission Wali prélevée |
| `win_type` | win_type ENUM | NULL | NULL jusqu'à la fin |
| `nb_players` | SMALLINT | NOT NULL 2–8 | Nombre de joueurs |
| `status` | game_status ENUM | NOT NULL DEFAULT 'waiting' | waiting / playing / finished / cancelled |
| `started_at` | TIMESTAMPTZ | NULL | Démarré quand start-game est émis |
| `finished_at` | TIMESTAMPTZ | NULL | Rempli par handleGameOver() |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | — |

**Index :** `club_id`, `dealer_id`, `winner_id`, `status`, `created_at DESC`

---

### `game_players`

Liaison partie ↔ joueur avec résultat individuel. Contrainte UNIQUE (session, user).

| Colonne | Type | Contrainte | Description |
|---|---|---|---|
| `id` | SERIAL | PK | — |
| `game_session_id` | INTEGER | FK → game_sessions.id | — |
| `user_id` | INTEGER | FK → users.id | — |
| `stake_paid` | NUMERIC(10,2) | NOT NULL > 0 | Mise débitée |
| `gain_received` | NUMERIC(15,2) | NOT NULL DEFAULT 0 ≥ 0 | 0 pour les perdants |
| `result` | player_result ENUM | NOT NULL DEFAULT 'loser' | winner / loser / banque / spectator |
| `cards_dealt` | JSONB | NULL | Main initiale `[{suit, value}]` |
| `final_cards` | JSONB | NULL | Cartes finales (joueurs PASS) |
| `joined_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | — |

**Index :** `game_session_id`, `user_id`, `result`  
**Contrainte UNIQUE :** `(game_session_id, user_id)` — un joueur une fois par partie

---

### `game_rounds`

Historique de chaque pli. Permet le rejeu complet d'une partie.

| Colonne | Type | Contrainte | Description |
|---|---|---|---|
| `id` | SERIAL | PK | — |
| `game_session_id` | INTEGER | FK → game_sessions.id | — |
| `round_number` | SMALLINT | NOT NULL ≥ 1 | Numéro de pli dans la partie |
| `leader_id` | INTEGER | FK → users.id NOT NULL | Joueur qui a mené le pli |
| `winner_id` | INTEGER | FK → users.id NULL | NULL possible si PASS final |
| `cards_played` | JSONB | NOT NULL | `[{user_id, username, card:{suit,value}}]` |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | — |

**Contrainte UNIQUE :** `(game_session_id, round_number)` — pas de doublon de pli

---

### `transactions`

Ledger financier immuable. Chaque mouvement d'argent crée une ligne.

| Colonne | Type | Contrainte | Description |
|---|---|---|---|
| `id` | SERIAL | PK | — |
| `user_id` | INTEGER | FK → users.id NOT NULL | Compte concerné |
| `club_id` | INTEGER | FK → clubs.id NULL | NULL pour transferts hors-jeu |
| `game_session_id` | INTEGER | FK → game_sessions.id NULL | NULL si hors-jeu |
| `sender_id` | INTEGER | FK → users.id NULL | Expéditeur (transferts) |
| `amount` | NUMERIC(15,2) | NOT NULL ≠ 0 | Négatif = débit, positif = crédit |
| `balance_before` | NUMERIC(15,2) | NOT NULL | Solde avant cette opération |
| `balance_after` | NUMERIC(15,2) | NOT NULL ≥ 0 | Solde après cette opération |
| `type` | transaction_type ENUM | NOT NULL | mise / gain / transfert / recharge / commission / remboursement |
| `status` | transaction_status ENUM | NOT NULL DEFAULT 'confirmed' | pending / confirmed / cancelled |
| `note` | VARCHAR(255) | NULL | Commentaire admin optionnel |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | — |

**Index :** `user_id`, `club_id`, `game_session_id`, `created_at DESC`, `type`, `status`

---

### `commissions`

Une ligne créée par `handleGameOver()` — traçabilité des prélèvements Wali.

| Colonne | Type | Description |
|---|---|---|
| `game_session_id` | INTEGER FK | Partie source |
| `club_id` | INTEGER FK | Club source |
| `wali_id` | INTEGER FK | Receveur de la commission |
| `katika_id` | INTEGER FK | Katika du club |
| `pot_total` | NUMERIC(15,2) | Pot de la partie |
| `rate` | NUMERIC(5,4) | Taux appliqué (issu de clubs.commission_rate) |
| `amount` | NUMERIC(15,2) | `pot_total × rate` — toujours > 0 |
| `status` | commission_status ENUM | pending / paid / disputed |
| `paid_at` | TIMESTAMPTZ | NULL tant que pending |

---

### `recharge_requests`

Workflow de demande de recharge wallet (remplace le stub `/api/money/recharge`).

| Colonne | Type | Description |
|---|---|---|
| `requester_id` | INTEGER FK | Katika ou Player qui demande |
| `target_id` | INTEGER FK | Utilisateur à recharger |
| `amount` | NUMERIC(15,2) | Montant demandé > 0 |
| `status` | recharge_status ENUM | pending / approved / rejected |
| `reviewed_by` | INTEGER FK | Wali ou Katika qui a traité |
| `reviewed_at` | TIMESTAMPTZ | — |
| `note` | VARCHAR(500) | Motif de rejet ou commentaire |

---

### `audit_logs`

Journal d'audit immuable. `BIGSERIAL` car peut atteindre des millions de lignes.

| Colonne | Type | Description |
|---|---|---|
| `id` | BIGSERIAL | PK — pas de limite pratique |
| `user_id` | INTEGER FK NULL | NULL si action système (ON DELETE SET NULL) |
| `action` | VARCHAR(100) | `login`, `create_katika`, `transfer`, `game_start`, `claim_victory` |
| `entity_type` | VARCHAR(50) | Table concernée : `user`, `club`, `transaction`, `game_session` |
| `entity_id` | INTEGER | ID de la ligne concernée |
| `old_value` | JSONB | État avant modification |
| `new_value` | JSONB | État après modification |
| `ip_address` | INET | Type natif PostgreSQL — IPv4 et IPv6 |
| `user_agent` | TEXT | En-tête HTTP User-Agent |
| `created_at` | TIMESTAMPTZ | Immuable |

---

## Types ENUM

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

## Clés étrangères (22)

| De | Vers | ON DELETE |
|---|---|---|
| `users.club_id` | `clubs.id` | SET NULL |
| `clubs.katika_id` | `users.id` | — |
| `game_sessions.club_id` | `clubs.id` | — |
| `game_sessions.dealer_id` | `users.id` | — |
| `game_sessions.winner_id` | `users.id` | — |
| `game_players.game_session_id` | `game_sessions.id` | — |
| `game_players.user_id` | `users.id` | — |
| `game_rounds.game_session_id` | `game_sessions.id` | — |
| `game_rounds.leader_id` | `users.id` | — |
| `game_rounds.winner_id` | `users.id` | — |
| `transactions.user_id` | `users.id` | — |
| `transactions.club_id` | `clubs.id` | — |
| `transactions.game_session_id` | `game_sessions.id` | SET NULL |
| `transactions.sender_id` | `users.id` | — |
| `commissions.game_session_id` | `game_sessions.id` | — |
| `commissions.club_id` | `clubs.id` | — |
| `commissions.wali_id` | `users.id` | — |
| `commissions.katika_id` | `users.id` | — |
| `recharge_requests.requester_id` | `users.id` | — |
| `recharge_requests.target_id` | `users.id` | — |
| `recharge_requests.reviewed_by` | `users.id` | — |
| `audit_logs.user_id` | `users.id` | SET NULL |

---

## Contraintes métier CHECK

| Table | Contrainte | Règle |
|---|---|---|
| `users` | `chk_users_wallet` | `wallet >= 0` — solde jamais négatif |
| `clubs` | `chk_clubs_stake` | `stake_default > 0` |
| `clubs` | `chk_clubs_players` | `max_players BETWEEN 2 AND 8` |
| `clubs` | `chk_clubs_commission` | `commission_rate BETWEEN 0 AND 1` |
| `game_sessions` | `chk_gs_stake` | `stake > 0` |
| `game_sessions` | `chk_gs_players` | `nb_players BETWEEN 2 AND 8` |
| `game_sessions` | `chk_gs_commission` | `commission >= 0` |
| `game_players` | `chk_gp_stake` | `stake_paid > 0` |
| `game_players` | `chk_gp_gain` | `gain_received >= 0` |
| `game_rounds` | `chk_gr_round` | `round_number >= 1` |
| `transactions` | `chk_tx_amount` | `amount <> 0` — pas de transaction nulle |
| `transactions` | `chk_tx_balance` | `balance_after >= 0` — solde post-opération positif |
| `commissions` | `chk_com_amount` | `amount > 0` |
| `commissions` | `chk_com_rate` | `rate > 0 AND rate <= 1` |
| `recharge_requests` | `chk_rr_amount` | `amount > 0` |

---

## Décisions techniques PostgreSQL vs MySQL

| Aspect | MySQL (ancien) | PostgreSQL (nouveau) | Raison |
|---|---|---|---|
| Auto-increment | `AUTO_INCREMENT` | `SERIAL` | Standard PostgreSQL |
| Entiers larges | `BIGINT AUTO_INCREMENT` | `BIGSERIAL` | audit_logs.id |
| Nombres décimaux | `DECIMAL(15,2)` | `NUMERIC(15,2)` | Aliases — même précision |
| Petits entiers | `TINYINT` | `SMALLINT` | TINYINT n'existe pas en PG |
| Booléens | `TINYINT(1)` | `BOOLEAN` | Type natif PG |
| JSON | `JSON` | `JSONB` | Binary JSON — indexable, plus rapide |
| Dates | `TIMESTAMP` | `TIMESTAMPTZ` | Avec timezone — recommandé |
| IP addresses | `VARCHAR(45)` | `INET` | Type natif PG — valide IPv4/IPv6 |
| ENUM | `ENUM(...)` inline | `CREATE TYPE ... AS ENUM` | Réutilisable, extensible |
| updated_at auto | `ON UPDATE CURRENT_TIMESTAMP` | Trigger `set_updated_at()` | PG n'a pas ON UPDATE |
| Dépendance circulaire | FK inline possible | `ALTER TABLE ADD CONSTRAINT` | Résolution explicite |
| Placeholders requêtes | `?` | `$1, $2, $3...` | Positionnels en PG |
| insertId | `result.insertId` | `RETURNING id` | Doit être ajouté aux INSERT |

---

## Flux de données d'une partie complète

```
1. join-table
   → SELECT users WHERE username = ?
   → (futur) INSERT game_sessions (status='waiting')

2. start-game
   → SELECT wallet FROM users (vérif fonds)
   → UPDATE users SET wallet = wallet - stake
   → INSERT transactions (type='mise', balance_before, balance_after)
   → (futur) UPDATE game_sessions SET status='playing', started_at=NOW()
   → (futur) INSERT game_players (user_id, stake_paid, cards_dealt)

3. card-played (fin de pli)
   → (futur) INSERT game_rounds (round_number, cards_played, winner_id)

4. handleGameOver()
   → UPDATE users SET wallet = wallet + pot
   → INSERT transactions (type='gain', balance_before, balance_after)
   → (futur) UPDATE game_sessions SET winner_id, win_type, status='finished'
   → (futur) UPDATE game_players SET result, gain_received
   → (futur) INSERT commissions (amount = pot * commission_rate)

5. Crash serveur
   → (futur) UPDATE game_sessions SET status='cancelled'
   → (futur) INSERT transactions (type='remboursement') × nb_joueurs
```

Les étapes `(futur)` seront implémentées lors de la migration du code mysql2 → pg.
