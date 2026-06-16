# 03 — Schéma Recommandé & Diagramme Relationnel

> Date : 2026-06-15

---

## Synthèse des changements

| Action | Tables concernées |
|--------|-------------------|
| **Conserver & améliorer** | `users`, `clubs`, `transactions` |
| **Créer** | `game_sessions`, `game_rounds`, `game_players`, `commissions`, `recharge_requests`, `audit_logs` |
| **Supprimer** | Aucune (3 tables seulement, toutes utiles) |
| **Fusionner** | N/A |

---

## Schéma recommandé complet

### Table `users` (modifiée)

```sql
CREATE TABLE users (
  id           INT           PRIMARY KEY AUTO_INCREMENT,
  username     VARCHAR(100)  NOT NULL,
  phone        VARCHAR(20)   UNIQUE NOT NULL,
  password     VARCHAR(255)  NOT NULL,
  role         ENUM('superadmin','katika','player') NOT NULL DEFAULT 'player',
  wallet       DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  club_id      INT           NULL,
  status       ENUM('active','suspended','inactive') NOT NULL DEFAULT 'active',
  last_login   TIMESTAMP     NULL,
  created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_phone (phone),
  INDEX idx_club_id (club_id),
  INDEX idx_role (role),
  CONSTRAINT fk_users_club FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE SET NULL,
  CONSTRAINT chk_wallet_positive CHECK (wallet >= 0)
);
```

**Changements :**
- `status` : gérer la suspension sans suppression
- `last_login` : sécurité + analytics
- `updated_at` : traçabilité des modifications
- `CHECK wallet >= 0` : empêcher les soldes négatifs au niveau DB
- Index sur `phone`, `club_id`, `role`
- Suppression de `username UNIQUE` (deux joueurs de clubs différents peuvent avoir le même pseudo)

---

### Table `clubs` (modifiée)

```sql
CREATE TABLE clubs (
  id              INT           PRIMARY KEY AUTO_INCREMENT,
  name            VARCHAR(100)  NOT NULL,
  katika_id       INT           NOT NULL,
  stake_default   DECIMAL(10,2) NOT NULL DEFAULT 500.00,
  max_players     TINYINT       NOT NULL DEFAULT 4,
  commission_rate DECIMAL(5,4)  NOT NULL DEFAULT 0.0500,  -- 5% Wali
  status          ENUM('open','closed','suspended') NOT NULL DEFAULT 'open',
  created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_katika_id (katika_id),
  CONSTRAINT fk_clubs_katika FOREIGN KEY (katika_id) REFERENCES users(id)
);
```

**Changements :**
- `stake_default` : la mise est configurable par club (était hardcodée à 500)
- `max_players` : paramétrable (était hardcodé à 4)
- `commission_rate` : taux de commission Wali par club
- `status` : ouvrir/fermer/suspendre un club
- `updated_at` : traçabilité

---

### Table `transactions` (modifiée)

```sql
CREATE TABLE transactions (
  id               INT            PRIMARY KEY AUTO_INCREMENT,
  user_id          INT            NOT NULL,
  club_id          INT            NULL,
  game_session_id  INT            NULL,
  sender_id        INT            NULL,
  amount           DECIMAL(15,2)  NOT NULL,
  balance_before   DECIMAL(15,2)  NOT NULL,
  balance_after    DECIMAL(15,2)  NOT NULL,
  type             ENUM('mise','gain','transfert','recharge','commission','remboursement') NOT NULL,
  status           ENUM('pending','confirmed','cancelled') NOT NULL DEFAULT 'confirmed',
  note             VARCHAR(255)   NULL,
  created_at       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_user_id (user_id),
  INDEX idx_game_session_id (game_session_id),
  INDEX idx_created_at (created_at),
  CONSTRAINT fk_tx_user    FOREIGN KEY (user_id)         REFERENCES users(id),
  CONSTRAINT fk_tx_club    FOREIGN KEY (club_id)         REFERENCES clubs(id),
  CONSTRAINT fk_tx_session FOREIGN KEY (game_session_id) REFERENCES game_sessions(id) ON DELETE SET NULL,
  CONSTRAINT fk_tx_sender  FOREIGN KEY (sender_id)       REFERENCES users(id)
);
```

**Changements :**
- `game_session_id` : lier chaque mise/gain à une partie précise
- `balance_before` / `balance_after` : audit complet sans recalcul
- `status` : pending → confirmed (pour les recharges en attente)
- Types ajoutés : `recharge`, `commission`, `remboursement`
- `note` : commentaire libre pour les admins

---

### Table `game_sessions` (NOUVELLE)

```sql
CREATE TABLE game_sessions (
  id            INT           PRIMARY KEY AUTO_INCREMENT,
  club_id       INT           NOT NULL,
  dealer_id     INT           NOT NULL,
  winner_id     INT           NULL,
  stake         DECIMAL(10,2) NOT NULL,
  pot_total     DECIMAL(15,2) NOT NULL DEFAULT 0,
  commission    DECIMAL(15,2) NOT NULL DEFAULT 0,
  win_type      ENUM('normal','koratte','carre','tchia','trois_sept','couleur','tous_banque') NULL,
  nb_players    TINYINT       NOT NULL,
  status        ENUM('waiting','playing','finished','cancelled') NOT NULL DEFAULT 'waiting',
  started_at    TIMESTAMP     NULL,
  finished_at   TIMESTAMP     NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_club_id (club_id),
  INDEX idx_dealer_id (dealer_id),
  INDEX idx_winner_id (winner_id),
  INDEX idx_status (status),
  CONSTRAINT fk_gs_club   FOREIGN KEY (club_id)   REFERENCES clubs(id),
  CONSTRAINT fk_gs_dealer FOREIGN KEY (dealer_id) REFERENCES users(id),
  CONSTRAINT fk_gs_winner FOREIGN KEY (winner_id) REFERENCES users(id)
);
```

**Utilité :**
- Historique complet de toutes les parties
- Analytics (combien de parties par jour, par club)
- Lier les transactions à une partie précise
- Remboursement possible si `status = 'cancelled'`

---

### Table `game_players` (NOUVELLE)

```sql
CREATE TABLE game_players (
  id               INT           PRIMARY KEY AUTO_INCREMENT,
  game_session_id  INT           NOT NULL,
  user_id          INT           NOT NULL,
  stake_paid       DECIMAL(10,2) NOT NULL,
  gain_received    DECIMAL(15,2) NOT NULL DEFAULT 0,
  result           ENUM('winner','loser','banque','spectator') NOT NULL DEFAULT 'loser',
  cards_dealt      JSON          NULL,   -- main initiale pour audit
  final_cards      JSON          NULL,   -- cartes finales (passeurs)
  joined_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_session_player (game_session_id, user_id),
  INDEX idx_user_id (user_id),
  CONSTRAINT fk_gp_session FOREIGN KEY (game_session_id) REFERENCES game_sessions(id),
  CONSTRAINT fk_gp_user    FOREIGN KEY (user_id)         REFERENCES users(id)
);
```

**Utilité :**
- Qui a joué dans quelle partie
- Statistiques joueur (winrate, total misé, total gagné)
- Audit des mains distribuées

---

### Table `game_rounds` (NOUVELLE)

```sql
CREATE TABLE game_rounds (
  id               INT       PRIMARY KEY AUTO_INCREMENT,
  game_session_id  INT       NOT NULL,
  round_number     TINYINT   NOT NULL,
  leader_id        INT       NOT NULL,   -- joueur qui a mené le pli
  winner_id        INT       NULL,       -- gagnant du pli
  cards_played     JSON      NOT NULL,   -- [{user_id, card:{suit,value}}]
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_session_id (game_session_id),
  CONSTRAINT fk_gr_session FOREIGN KEY (game_session_id) REFERENCES game_sessions(id),
  CONSTRAINT fk_gr_leader  FOREIGN KEY (leader_id)       REFERENCES users(id),
  CONSTRAINT fk_gr_winner  FOREIGN KEY (winner_id)       REFERENCES users(id)
);
```

**Utilité :**
- Rejeu complet de toute partie (debug, litiges)
- Statistiques sur les plis

---

### Table `commissions` (NOUVELLE)

```sql
CREATE TABLE commissions (
  id               INT           PRIMARY KEY AUTO_INCREMENT,
  game_session_id  INT           NOT NULL,
  club_id          INT           NOT NULL,
  wali_id          INT           NOT NULL,
  katika_id        INT           NOT NULL,
  pot_total        DECIMAL(15,2) NOT NULL,
  rate             DECIMAL(5,4)  NOT NULL,
  amount           DECIMAL(15,2) NOT NULL,
  status           ENUM('pending','paid','disputed') NOT NULL DEFAULT 'pending',
  paid_at          TIMESTAMP     NULL,
  created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_session_id (game_session_id),
  INDEX idx_wali_id (wali_id),
  CONSTRAINT fk_com_session  FOREIGN KEY (game_session_id) REFERENCES game_sessions(id),
  CONSTRAINT fk_com_club     FOREIGN KEY (club_id)         REFERENCES clubs(id),
  CONSTRAINT fk_com_wali     FOREIGN KEY (wali_id)         REFERENCES users(id),
  CONSTRAINT fk_com_katika   FOREIGN KEY (katika_id)       REFERENCES users(id)
);
```

**Utilité :**
- Traçabilité des commissions dues au Wali
- Gestion des litiges
- Flux financier entre Katika et Wali

---

### Table `recharge_requests` (NOUVELLE)

```sql
CREATE TABLE recharge_requests (
  id           INT           PRIMARY KEY AUTO_INCREMENT,
  requester_id INT           NOT NULL,    -- Katika ou Player
  target_id    INT           NOT NULL,    -- qui doit être rechargé
  amount       DECIMAL(15,2) NOT NULL,
  status       ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  reviewed_by  INT           NULL,         -- id du Wali/Katika ayant traité
  reviewed_at  TIMESTAMP     NULL,
  note         VARCHAR(500)  NULL,
  created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_requester (requester_id),
  INDEX idx_status (status),
  CONSTRAINT fk_rr_requester  FOREIGN KEY (requester_id) REFERENCES users(id),
  CONSTRAINT fk_rr_target     FOREIGN KEY (target_id)    REFERENCES users(id),
  CONSTRAINT fk_rr_reviewer   FOREIGN KEY (reviewed_by)  REFERENCES users(id)
);
```

**Utilité :**
- Remplacement du stub `/api/money/recharge`
- Workflow d'approbation des demandes de recharge

---

### Table `audit_logs` (NOUVELLE)

```sql
CREATE TABLE audit_logs (
  id          BIGINT        PRIMARY KEY AUTO_INCREMENT,
  user_id     INT           NULL,
  action      VARCHAR(100)  NOT NULL,   -- 'login', 'create_katika', 'transfer', etc.
  entity_type VARCHAR(50)   NULL,       -- 'user', 'club', 'transaction'
  entity_id   INT           NULL,
  old_value   JSON          NULL,
  new_value   JSON          NULL,
  ip_address  VARCHAR(45)   NULL,
  user_agent  VARCHAR(500)  NULL,
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_user_id (user_id),
  INDEX idx_action (action),
  INDEX idx_created_at (created_at),
  CONSTRAINT fk_al_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
```

**Utilité :**
- Traçabilité complète pour audit
- Détection d'anomalies (transactions suspectes)
- Conformité réglementaire

---

## Diagramme relationnel complet (ASCII)

```
┌──────────────────────────────────────────────────────────────────┐
│                            users                                 │
│  id (PK) | username | phone | password | role | wallet          │
│  status | club_id (FK) | last_login | created_at | updated_at  │
└─────────────┬───────────────────┬────────────────────────────────┘
              │                   │
              │ katika_id         │ club_id
              ▼                   ▼
┌─────────────────────┐    (auto-référence)
│       clubs         │
│  id (PK)            │
│  name               │
│  katika_id (FK)─────┘
│  stake_default      │
│  max_players        │
│  commission_rate    │
│  status             │
│  created_at         │
└──────────┬──────────┘
           │
           │ club_id
           ▼
┌──────────────────────────────┐
│       game_sessions          │
│  id (PK)                     │
│  club_id (FK→clubs)          │
│  dealer_id (FK→users)        │
│  winner_id (FK→users)        │
│  stake | pot_total           │
│  commission | win_type       │
│  nb_players | status         │
│  started_at | finished_at    │
└───────┬────────────┬─────────┘
        │            │
        │            │ game_session_id
        ▼            ▼
┌────────────┐  ┌─────────────────────┐
│game_rounds │  │    game_players     │
│ id (PK)    │  │  id (PK)            │
│session_id  │  │  game_session_id    │
│round_number│  │  user_id (FK)       │
│leader_id   │  │  stake_paid         │
│winner_id   │  │  gain_received      │
│cards_played│  │  result             │
│created_at  │  │  cards_dealt (JSON) │
└────────────┘  │  final_cards (JSON) │
                └─────────────────────┘

┌──────────────────────────────────────┐
│           transactions               │
│  id (PK)                             │
│  user_id (FK→users)                  │
│  club_id (FK→clubs)                  │
│  game_session_id (FK→game_sessions)  │
│  sender_id (FK→users)                │
│  amount | balance_before/after       │
│  type | status | note                │
│  created_at                          │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│           commissions                │
│  id (PK)                             │
│  game_session_id (FK)                │
│  club_id (FK) | wali_id (FK)         │
│  katika_id (FK)                      │
│  pot_total | rate | amount           │
│  status | paid_at | created_at       │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│        recharge_requests             │
│  id (PK)                             │
│  requester_id (FK→users)             │
│  target_id (FK→users)                │
│  amount | status                     │
│  reviewed_by (FK→users)              │
│  reviewed_at | note | created_at     │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│           audit_logs                 │
│  id (PK BIGINT)                      │
│  user_id (FK→users)                  │
│  action | entity_type | entity_id    │
│  old_value (JSON) | new_value (JSON) │
│  ip_address | user_agent             │
│  created_at                          │
└──────────────────────────────────────┘
```

---

## Récapitulatif des migrations

### Tables à supprimer
> Aucune. Les 3 tables existantes sont toutes utiles.

### Tables à créer (6)
1. `game_sessions` — historique des parties
2. `game_players` — joueurs par partie
3. `game_rounds` — plis par partie
4. `commissions` — commissions Wali
5. `recharge_requests` — demandes de recharge
6. `audit_logs` — traçabilité admin

### Colonnes à ajouter
- `users` : `status`, `last_login`, `updated_at`
- `clubs` : `stake_default`, `max_players`, `commission_rate`, `status`, `updated_at`
- `transactions` : `game_session_id`, `balance_before`, `balance_after`, `status`, `note`

### Colonnes à modifier
- `transactions.type` : ajouter `recharge`, `commission`, `remboursement`
- `users.club_id` : passer de contrainte stricte à `ON DELETE SET NULL`
