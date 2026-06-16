-- ============================================================
-- FAP FAP — Schéma PostgreSQL Complet
-- Base    : neondb (Neon Cloud, eu-west-2)
-- Version : PostgreSQL 18.4
-- Date    : 2026-06-15
-- Auteur  : Reconstitué par reverse-engineering + enrichissement
-- ============================================================
-- Ordre de création (résolution des dépendances circulaires) :
--   1.  Types ENUM
--   2.  Fonction trigger set_updated_at()
--   3.  TABLE users         (sans FK club_id → clubs)
--   4.  TABLE clubs         (FK katika_id → users)
--   5.  ALTER TABLE users   (FK club_id → clubs)
--   6.  TABLE game_sessions (FK → clubs, users)
--   7.  TABLE game_players  (FK → game_sessions, users)
--   8.  TABLE game_rounds   (FK → game_sessions, users)
--   9.  TABLE transactions  (FK → users, clubs, game_sessions)
--   10. TABLE commissions   (FK → game_sessions, clubs, users×2)
--   11. TABLE recharge_requests (FK → users×3)
--   12. TABLE audit_logs    (FK → users)
--   13. TRIGGERS updated_at
--   14. INDEX
-- ============================================================


-- ============================================================
-- SECTION 1 : TYPES ENUM
-- ============================================================

CREATE TYPE user_role AS ENUM (
    'superadmin',
    'katika',
    'player'
);

CREATE TYPE user_status AS ENUM (
    'active',
    'suspended',
    'inactive'
);

CREATE TYPE club_status AS ENUM (
    'open',
    'closed',
    'suspended'
);

CREATE TYPE transaction_type AS ENUM (
    'mise',
    'gain',
    'transfert',
    'recharge',
    'commission',
    'remboursement'
);

CREATE TYPE transaction_status AS ENUM (
    'pending',
    'confirmed',
    'cancelled'
);

CREATE TYPE game_status AS ENUM (
    'waiting',
    'playing',
    'finished',
    'cancelled'
);

CREATE TYPE win_type AS ENUM (
    'normal',
    'koratte',
    'carre',
    'tchia',
    'trois_sept',
    'couleur',
    'tous_banque'
);

CREATE TYPE player_result AS ENUM (
    'winner',
    'loser',
    'banque',
    'spectator'
);

CREATE TYPE commission_status AS ENUM (
    'pending',
    'paid',
    'disputed'
);

CREATE TYPE recharge_status AS ENUM (
    'pending',
    'approved',
    'rejected'
);


-- ============================================================
-- SECTION 2 : FONCTION TRIGGER updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $func$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$func$ LANGUAGE plpgsql;


-- ============================================================
-- SECTION 3 : TABLE users
-- Dépendance circulaire → FK club_id ajoutée en section 5
-- ============================================================

CREATE TABLE users (
    id          SERIAL          PRIMARY KEY,
    username    VARCHAR(100)    NOT NULL,
    phone       VARCHAR(20)     NOT NULL,
    password    VARCHAR(255)    NOT NULL,       -- bcrypt hash
    role        user_role       NOT NULL DEFAULT 'player',
    wallet      NUMERIC(15, 2)  NOT NULL DEFAULT 0.00,
    club_id     INTEGER         NULL,           -- FK ajoutée après clubs
    status      user_status     NOT NULL DEFAULT 'active',
    last_login  TIMESTAMPTZ     NULL,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_users_phone   UNIQUE (phone),
    CONSTRAINT chk_users_wallet CHECK (wallet >= 0)
);

COMMENT ON TABLE  users               IS 'Utilisateurs : Wali (superadmin), Katika (gestionnaire), Player (joueur)';
COMMENT ON COLUMN users.wallet        IS 'Solde en FCFA — toujours >= 0 (contrainte CHECK)';
COMMENT ON COLUMN users.club_id       IS 'NULL pour Wali, défini pour Katika et Player';
COMMENT ON COLUMN users.status        IS 'active=normal, suspended=bloqué temporairement, inactive=archivé';
COMMENT ON COLUMN users.last_login    IS 'Mis à jour à chaque connexion réussie (LOGIN endpoint)';


-- ============================================================
-- SECTION 4 : TABLE clubs
-- ============================================================

CREATE TABLE clubs (
    id              SERIAL          PRIMARY KEY,
    name            VARCHAR(100)    NOT NULL,
    katika_id       INTEGER         NOT NULL,
    stake_default   NUMERIC(10, 2)  NOT NULL DEFAULT 500.00,
    max_players     SMALLINT        NOT NULL DEFAULT 4,
    commission_rate NUMERIC(5, 4)   NOT NULL DEFAULT 0.0500,
    status          club_status     NOT NULL DEFAULT 'open',
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_clubs_katika      FOREIGN KEY (katika_id)  REFERENCES users(id),
    CONSTRAINT chk_clubs_stake      CHECK (stake_default > 0),
    CONSTRAINT chk_clubs_players    CHECK (max_players BETWEEN 2 AND 8),
    CONSTRAINT chk_clubs_commission CHECK (commission_rate BETWEEN 0 AND 1)
);

COMMENT ON TABLE  clubs                  IS 'Clubs de jeu — chaque club appartient à un Katika';
COMMENT ON COLUMN clubs.stake_default    IS 'Mise par défaut du club en FCFA (était hardcodée à 500 dans server.js)';
COMMENT ON COLUMN clubs.max_players      IS 'Nombre max de joueurs par table (était hardcodé à 4)';
COMMENT ON COLUMN clubs.commission_rate  IS 'Taux de commission Wali sur le pot (ex: 0.0500 = 5%)';


-- ============================================================
-- SECTION 5 : FK circulaire users.club_id → clubs.id
-- ============================================================

ALTER TABLE users
    ADD CONSTRAINT fk_users_club
    FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE SET NULL;


-- ============================================================
-- SECTION 6 : TABLE game_sessions
-- ============================================================

CREATE TABLE game_sessions (
    id          SERIAL          PRIMARY KEY,
    club_id     INTEGER         NOT NULL,
    dealer_id   INTEGER         NOT NULL,
    winner_id   INTEGER         NULL,
    stake       NUMERIC(10, 2)  NOT NULL,
    pot_total   NUMERIC(15, 2)  NOT NULL DEFAULT 0,
    commission  NUMERIC(15, 2)  NOT NULL DEFAULT 0,
    win_type    win_type        NULL,
    nb_players  SMALLINT        NOT NULL,
    status      game_status     NOT NULL DEFAULT 'waiting',
    started_at  TIMESTAMPTZ     NULL,
    finished_at TIMESTAMPTZ     NULL,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_gs_club       FOREIGN KEY (club_id)   REFERENCES clubs(id),
    CONSTRAINT fk_gs_dealer     FOREIGN KEY (dealer_id) REFERENCES users(id),
    CONSTRAINT fk_gs_winner     FOREIGN KEY (winner_id) REFERENCES users(id),
    CONSTRAINT chk_gs_stake     CHECK (stake > 0),
    CONSTRAINT chk_gs_players   CHECK (nb_players BETWEEN 2 AND 8),
    CONSTRAINT chk_gs_commission CHECK (commission >= 0)
);

COMMENT ON TABLE  game_sessions             IS 'Historique de toutes les parties jouées';
COMMENT ON COLUMN game_sessions.win_type    IS 'NULL tant que la partie est en cours';
COMMENT ON COLUMN game_sessions.commission  IS 'Montant de commission Wali prélevé sur ce pot';
COMMENT ON COLUMN game_sessions.pot_total   IS 'stake × nb_players (doublé si KORATTE)';


-- ============================================================
-- SECTION 7 : TABLE game_players
-- ============================================================

CREATE TABLE game_players (
    id               SERIAL          PRIMARY KEY,
    game_session_id  INTEGER         NOT NULL,
    user_id          INTEGER         NOT NULL,
    stake_paid       NUMERIC(10, 2)  NOT NULL,
    gain_received    NUMERIC(15, 2)  NOT NULL DEFAULT 0,
    result           player_result   NOT NULL DEFAULT 'loser',
    cards_dealt      JSONB           NULL,
    final_cards      JSONB           NULL,
    joined_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_session_player  UNIQUE (game_session_id, user_id),
    CONSTRAINT fk_gp_session      FOREIGN KEY (game_session_id) REFERENCES game_sessions(id),
    CONSTRAINT fk_gp_user         FOREIGN KEY (user_id)         REFERENCES users(id),
    CONSTRAINT chk_gp_stake       CHECK (stake_paid > 0),
    CONSTRAINT chk_gp_gain        CHECK (gain_received >= 0)
);

COMMENT ON TABLE  game_players             IS 'Liaison partie ↔ joueur avec résultat individuel';
COMMENT ON COLUMN game_players.cards_dealt IS 'Main initiale reçue : [{suit,value}, ...] — pour audit';
COMMENT ON COLUMN game_players.final_cards IS 'Cartes finales (joueurs ayant PASSé) — révélées en fin de manche';
COMMENT ON COLUMN game_players.result      IS 'winner=a gagné, loser=a perdu, banque=a banqué, spectator=observateur';


-- ============================================================
-- SECTION 8 : TABLE game_rounds
-- ============================================================

CREATE TABLE game_rounds (
    id               SERIAL      PRIMARY KEY,
    game_session_id  INTEGER     NOT NULL,
    round_number     SMALLINT    NOT NULL,
    leader_id        INTEGER     NOT NULL,
    winner_id        INTEGER     NULL,
    cards_played     JSONB       NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_gr_round       UNIQUE (game_session_id, round_number),
    CONSTRAINT fk_gr_session     FOREIGN KEY (game_session_id) REFERENCES game_sessions(id),
    CONSTRAINT fk_gr_leader      FOREIGN KEY (leader_id)       REFERENCES users(id),
    CONSTRAINT fk_gr_winner      FOREIGN KEY (winner_id)       REFERENCES users(id),
    CONSTRAINT chk_gr_round      CHECK (round_number >= 1)
);

COMMENT ON TABLE  game_rounds              IS 'Historique de chaque pli (trick) par partie';
COMMENT ON COLUMN game_rounds.leader_id    IS 'Joueur qui a mené le pli (posé la première carte)';
COMMENT ON COLUMN game_rounds.cards_played IS '[{user_id, username, card:{suit,value}}, ...]';


-- ============================================================
-- SECTION 9 : TABLE transactions
-- ============================================================

CREATE TABLE transactions (
    id               SERIAL              PRIMARY KEY,
    user_id          INTEGER             NOT NULL,
    club_id          INTEGER             NULL,
    game_session_id  INTEGER             NULL,
    sender_id        INTEGER             NULL,
    amount           NUMERIC(15, 2)      NOT NULL,
    balance_before   NUMERIC(15, 2)      NOT NULL,
    balance_after    NUMERIC(15, 2)      NOT NULL,
    type             transaction_type    NOT NULL,
    status           transaction_status  NOT NULL DEFAULT 'confirmed',
    note             VARCHAR(255)        NULL,
    created_at       TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_tx_user       FOREIGN KEY (user_id)         REFERENCES users(id),
    CONSTRAINT fk_tx_club       FOREIGN KEY (club_id)         REFERENCES clubs(id),
    CONSTRAINT fk_tx_session    FOREIGN KEY (game_session_id) REFERENCES game_sessions(id) ON DELETE SET NULL,
    CONSTRAINT fk_tx_sender     FOREIGN KEY (sender_id)       REFERENCES users(id),
    CONSTRAINT chk_tx_amount    CHECK (amount <> 0),
    CONSTRAINT chk_tx_balance   CHECK (balance_after >= 0)
);

COMMENT ON TABLE  transactions                 IS 'Toutes les opérations financières (immuable, jamais effacer)';
COMMENT ON COLUMN transactions.amount          IS 'Négatif = débit (mise), positif = crédit (gain/transfert)';
COMMENT ON COLUMN transactions.balance_before  IS 'Solde wallet avant cette transaction';
COMMENT ON COLUMN transactions.balance_after   IS 'Solde wallet après cette transaction — toujours >= 0';
COMMENT ON COLUMN transactions.sender_id       IS 'Expéditeur pour type=transfert (Wali→Katika ou Katika→Player)';
COMMENT ON COLUMN transactions.game_session_id IS 'NULL si hors-jeu (transfert, recharge)';


-- ============================================================
-- SECTION 10 : TABLE commissions
-- ============================================================

CREATE TABLE commissions (
    id               SERIAL            PRIMARY KEY,
    game_session_id  INTEGER           NOT NULL,
    club_id          INTEGER           NOT NULL,
    wali_id          INTEGER           NOT NULL,
    katika_id        INTEGER           NOT NULL,
    pot_total        NUMERIC(15, 2)    NOT NULL,
    rate             NUMERIC(5, 4)     NOT NULL,
    amount           NUMERIC(15, 2)    NOT NULL,
    status           commission_status NOT NULL DEFAULT 'pending',
    paid_at          TIMESTAMPTZ       NULL,
    created_at       TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_com_session   FOREIGN KEY (game_session_id) REFERENCES game_sessions(id),
    CONSTRAINT fk_com_club      FOREIGN KEY (club_id)         REFERENCES clubs(id),
    CONSTRAINT fk_com_wali      FOREIGN KEY (wali_id)         REFERENCES users(id),
    CONSTRAINT fk_com_katika    FOREIGN KEY (katika_id)       REFERENCES users(id),
    CONSTRAINT chk_com_amount   CHECK (amount > 0),
    CONSTRAINT chk_com_rate     CHECK (rate > 0 AND rate <= 1)
);

COMMENT ON TABLE  commissions          IS 'Commission Wali sur chaque pot — 1 ligne par partie terminée';
COMMENT ON COLUMN commissions.amount   IS 'pot_total × rate — montant dû au Wali';
COMMENT ON COLUMN commissions.paid_at  IS 'NULL tant que status=pending';


-- ============================================================
-- SECTION 11 : TABLE recharge_requests
-- ============================================================

CREATE TABLE recharge_requests (
    id            SERIAL          PRIMARY KEY,
    requester_id  INTEGER         NOT NULL,
    target_id     INTEGER         NOT NULL,
    amount        NUMERIC(15, 2)  NOT NULL,
    status        recharge_status NOT NULL DEFAULT 'pending',
    reviewed_by   INTEGER         NULL,
    reviewed_at   TIMESTAMPTZ     NULL,
    note          VARCHAR(500)    NULL,
    created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_rr_requester  FOREIGN KEY (requester_id) REFERENCES users(id),
    CONSTRAINT fk_rr_target     FOREIGN KEY (target_id)    REFERENCES users(id),
    CONSTRAINT fk_rr_reviewer   FOREIGN KEY (reviewed_by)  REFERENCES users(id),
    CONSTRAINT chk_rr_amount    CHECK (amount > 0)
);

COMMENT ON TABLE  recharge_requests              IS 'Demandes de recharge wallet (stub /api/money/recharge)';
COMMENT ON COLUMN recharge_requests.requester_id IS 'Katika ou Player qui demande la recharge';
COMMENT ON COLUMN recharge_requests.target_id    IS 'Utilisateur dont le wallet sera rechargé';
COMMENT ON COLUMN recharge_requests.reviewed_by  IS 'Wali ou Katika ayant approuvé/rejeté';


-- ============================================================
-- SECTION 12 : TABLE audit_logs
-- ============================================================

CREATE TABLE audit_logs (
    id          BIGSERIAL     PRIMARY KEY,
    user_id     INTEGER       NULL,
    action      VARCHAR(100)  NOT NULL,
    entity_type VARCHAR(50)   NULL,
    entity_id   INTEGER       NULL,
    old_value   JSONB         NULL,
    new_value   JSONB         NULL,
    ip_address  INET          NULL,
    user_agent  TEXT          NULL,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_al_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

COMMENT ON TABLE  audit_logs             IS 'Journal d''audit immuable — toutes les actions sensibles';
COMMENT ON COLUMN audit_logs.action      IS 'Ex: login, create_katika, transfer, game_start, claim_victory';
COMMENT ON COLUMN audit_logs.entity_type IS 'Table concernée : user, club, transaction, game_session';
COMMENT ON COLUMN audit_logs.old_value   IS 'État avant modification (JSON)';
COMMENT ON COLUMN audit_logs.new_value   IS 'État après modification (JSON)';
COMMENT ON COLUMN audit_logs.ip_address  IS 'Adresse IPv4/IPv6 du client (type INET PostgreSQL)';


-- ============================================================
-- SECTION 13 : TRIGGERS updated_at
-- ============================================================

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_clubs_updated_at
    BEFORE UPDATE ON clubs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- SECTION 14 : INDEX
-- ============================================================

-- --- users ---
CREATE INDEX idx_users_phone    ON users(phone);
CREATE INDEX idx_users_club_id  ON users(club_id);
CREATE INDEX idx_users_role     ON users(role);
CREATE INDEX idx_users_status   ON users(status);

-- --- clubs ---
CREATE INDEX idx_clubs_katika_id ON clubs(katika_id);
CREATE INDEX idx_clubs_status    ON clubs(status);

-- --- game_sessions ---
CREATE INDEX idx_gs_club_id     ON game_sessions(club_id);
CREATE INDEX idx_gs_dealer_id   ON game_sessions(dealer_id);
CREATE INDEX idx_gs_winner_id   ON game_sessions(winner_id);
CREATE INDEX idx_gs_status      ON game_sessions(status);
CREATE INDEX idx_gs_created_at  ON game_sessions(created_at DESC);

-- --- game_players ---
CREATE INDEX idx_gp_session_id  ON game_players(game_session_id);
CREATE INDEX idx_gp_user_id     ON game_players(user_id);
CREATE INDEX idx_gp_result      ON game_players(result);

-- --- game_rounds ---
CREATE INDEX idx_gr_session_id  ON game_rounds(game_session_id);

-- --- transactions ---
CREATE INDEX idx_tx_user_id     ON transactions(user_id);
CREATE INDEX idx_tx_club_id     ON transactions(club_id);
CREATE INDEX idx_tx_session_id  ON transactions(game_session_id);
CREATE INDEX idx_tx_created_at  ON transactions(created_at DESC);
CREATE INDEX idx_tx_type        ON transactions(type);
CREATE INDEX idx_tx_status      ON transactions(status);

-- --- commissions ---
CREATE INDEX idx_com_session_id ON commissions(game_session_id);
CREATE INDEX idx_com_wali_id    ON commissions(wali_id);
CREATE INDEX idx_com_status     ON commissions(status);

-- --- recharge_requests ---
CREATE INDEX idx_rr_requester   ON recharge_requests(requester_id);
CREATE INDEX idx_rr_target      ON recharge_requests(target_id);
CREATE INDEX idx_rr_status      ON recharge_requests(status);

-- --- audit_logs ---
CREATE INDEX idx_al_user_id     ON audit_logs(user_id);
CREATE INDEX idx_al_action      ON audit_logs(action);
CREATE INDEX idx_al_created_at  ON audit_logs(created_at DESC);
CREATE INDEX idx_al_entity      ON audit_logs(entity_type, entity_id);

-- ============================================================
-- FIN DU SCHÉMA
-- 9 tables | 11 types ENUM | 2 triggers | 30 index
-- ============================================================
