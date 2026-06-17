-- =============================================================================
-- FAP FAP 2.0 — Migration 002 : Salon de jeu dynamique
-- Date       : 2026-06-17
-- Dépend de  : 001_neon_schema.sql (clubs, users, fn_set_updated_at)
-- Réversible : voir SECTION ROLLBACK en bas de fichier
-- =============================================================================
-- Exécuter depuis Neon Console → SQL Editor, ou :
--   psql $DATABASE_URL -f server/migrations/002_salon.sql
-- =============================================================================

BEGIN;

-- =============================================================================
-- SECTION 1 : EXTENSION
-- pgcrypto est disponible sur Neon — nécessaire pour gen_random_bytes()
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- =============================================================================
-- SECTION 2 : TYPE ÉNUMÉRÉ
-- =============================================================================

CREATE TYPE salon_table_status AS ENUM ('open', 'playing', 'closed');

-- 'open'    — table disponible, accepte joueurs et observateurs
-- 'playing' — partie en cours, nouveaux joueurs refusés (observateurs ok)
-- 'closed'  — table fermée par l'admin, personne n'entre


-- =============================================================================
-- SECTION 3 : TABLES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table : salon_tables
-- Représentation persistante des tables physiques du salon.
-- L'état en RAM (cartes, pot, tour…) reste dans tables{} de server.js.
-- Cette table enregistre l'existence et les métadonnées, pas le jeu en cours.
-- -----------------------------------------------------------------------------
CREATE TABLE salon_tables (
    id              SERIAL                  PRIMARY KEY,
    name            VARCHAR(50)             NOT NULL,
    club_id         INTEGER                 NULL
                        REFERENCES clubs(id) ON DELETE SET NULL,
    max_players     SMALLINT                NOT NULL DEFAULT 6,
    min_bet         NUMERIC(10,2)           NOT NULL DEFAULT 100.00,
    status          salon_table_status      NOT NULL DEFAULT 'open',
    invite_token    VARCHAR(64)             NOT NULL UNIQUE,
    created_by      INTEGER                 NULL
                        REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ             NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_st_max_players  CHECK (max_players BETWEEN 2 AND 8),
    CONSTRAINT chk_st_min_bet      CHECK (min_bet >= 0)
);

COMMENT ON TABLE  salon_tables IS 'Tables physiques du salon FAP FAP 2.0 — persistantes entre les parties';
COMMENT ON COLUMN salon_tables.invite_token IS 'Token 32 octets hex — lien d''invitation unique /salon.html?invite=<token>';
COMMENT ON COLUMN salon_tables.club_id      IS 'NULL = table globale du salon ; non NULL = table réservée à ce club';
COMMENT ON COLUMN salon_tables.min_bet      IS 'Mise minimale pour s''asseoir (en FCFA)';
COMMENT ON COLUMN salon_tables.max_players  IS 'Nombre de sièges disponibles (2-8)';


-- -----------------------------------------------------------------------------
-- Table : table_seats
-- Joueurs assis à une table (intention de jouer, wallet vérifié).
-- Une ligne par joueur assis. Supprimée quand le joueur se lève.
-- -----------------------------------------------------------------------------
CREATE TABLE table_seats (
    id              SERIAL          PRIMARY KEY,
    table_id        INTEGER         NOT NULL REFERENCES salon_tables(id) ON DELETE CASCADE,
    user_id         INTEGER         NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
    seat_number     SMALLINT        NOT NULL,
    joined_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_ts_table_seat     UNIQUE (table_id, seat_number),
    CONSTRAINT uq_ts_table_user     UNIQUE (table_id, user_id),
    CONSTRAINT chk_ts_seat_number   CHECK (seat_number >= 1)
);

COMMENT ON TABLE  table_seats IS 'Sièges occupés : un joueur assis par siège, par table';
COMMENT ON COLUMN table_seats.seat_number IS 'Numéro de siège 1..max_players — attribué au moment du join';


-- -----------------------------------------------------------------------------
-- Table : table_observers
-- Spectateurs d'une table (pas de siège, pas de mise, lecture seule).
-- Reçoivent les émissions display-card, player-list-update, etc.
-- Supprimés quand ils quittent la table ou se connectent à une autre.
-- -----------------------------------------------------------------------------
CREATE TABLE table_observers (
    id              SERIAL          PRIMARY KEY,
    table_id        INTEGER         NOT NULL REFERENCES salon_tables(id) ON DELETE CASCADE,
    user_id         INTEGER         NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
    joined_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_to_table_user     UNIQUE (table_id, user_id)
);

COMMENT ON TABLE  table_observers IS 'Spectateurs d''une table — pas de siège, reçoivent les événements du jeu';


-- =============================================================================
-- SECTION 4 : INDEX
-- =============================================================================

CREATE INDEX idx_salon_tables_status     ON salon_tables(status);
CREATE INDEX idx_salon_tables_club       ON salon_tables(club_id);
CREATE INDEX idx_salon_tables_token      ON salon_tables(invite_token);

CREATE INDEX idx_table_seats_table       ON table_seats(table_id);
CREATE INDEX idx_table_seats_user        ON table_seats(user_id);

CREATE INDEX idx_table_observers_table   ON table_observers(table_id);
CREATE INDEX idx_table_observers_user    ON table_observers(user_id);


-- =============================================================================
-- SECTION 5 : TRIGGERS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Trigger 1 : invite_token généré automatiquement à l'insertion
-- Utilise gen_random_bytes() de pgcrypto — 32 octets = 64 hex chars
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_salon_table_invite_token()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.invite_token IS NULL OR NEW.invite_token = '' THEN
        NEW.invite_token := encode(gen_random_bytes(32), 'hex');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_salon_table_token
    BEFORE INSERT ON salon_tables
    FOR EACH ROW
    EXECUTE FUNCTION fn_salon_table_invite_token();

COMMENT ON FUNCTION fn_salon_table_invite_token IS 'Génère invite_token si absent — appelé automatiquement à l''INSERT';


-- -----------------------------------------------------------------------------
-- Trigger 2 : updated_at automatique (réutilise fn_set_updated_at de 001)
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_salon_tables_updated_at
    BEFORE UPDATE ON salon_tables
    FOR EACH ROW
    EXECUTE FUNCTION fn_set_updated_at();


-- -----------------------------------------------------------------------------
-- Trigger 3 : Contrainte d'unicité étendue
-- Un joueur ne peut pas être assis ET observateur à la même table
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_check_seat_observer_exclusion()
RETURNS TRIGGER AS $$
BEGIN
    -- Si insertion dans table_seats : vérifier pas observateur de cette table
    IF TG_TABLE_NAME = 'table_seats' THEN
        IF EXISTS (
            SELECT 1 FROM table_observers
            WHERE table_id = NEW.table_id AND user_id = NEW.user_id
        ) THEN
            RAISE EXCEPTION
                'Utilisateur % est déjà observateur de la table % — se lever d''abord.',
                NEW.user_id, NEW.table_id;
        END IF;
    END IF;

    -- Si insertion dans table_observers : vérifier pas assis à cette table
    IF TG_TABLE_NAME = 'table_observers' THEN
        IF EXISTS (
            SELECT 1 FROM table_seats
            WHERE table_id = NEW.table_id AND user_id = NEW.user_id
        ) THEN
            RAISE EXCEPTION
                'Utilisateur % est déjà assis à la table % — se lever d''abord.',
                NEW.user_id, NEW.table_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_seats_exclusion
    BEFORE INSERT ON table_seats
    FOR EACH ROW
    EXECUTE FUNCTION fn_check_seat_observer_exclusion();

CREATE TRIGGER trg_observers_exclusion
    BEFORE INSERT ON table_observers
    FOR EACH ROW
    EXECUTE FUNCTION fn_check_seat_observer_exclusion();

COMMENT ON FUNCTION fn_check_seat_observer_exclusion IS
    'Garantit qu''un joueur ne peut pas être assis ET observateur à la même table';


-- =============================================================================
-- SECTION 6 : VUE — ÉTAT DU SALON
-- Vue temps réel du salon : toutes les tables avec joueurs et observateurs
-- =============================================================================

CREATE VIEW v_salon_state AS
SELECT
    st.id                                                               AS table_id,
    st.name                                                             AS table_name,
    st.status,
    st.min_bet,
    st.max_players,
    st.invite_token,
    c.name                                                              AS club_name,
    COUNT(DISTINCT ts.id)                                               AS seated_count,
    COUNT(DISTINCT to2.id)                                              AS observer_count,
    st.max_players - COUNT(DISTINCT ts.id)                              AS available_seats,
    COALESCE(
        jsonb_agg(DISTINCT jsonb_build_object(
            'user_id',      ts.user_id,
            'username',     us.username,
            'seat_number',  ts.seat_number
        )) FILTER (WHERE ts.id IS NOT NULL),
        '[]'
    )                                                                   AS seated_players,
    COALESCE(
        jsonb_agg(DISTINCT jsonb_build_object(
            'user_id',      to2.user_id,
            'username',     uo.username
        )) FILTER (WHERE to2.id IS NOT NULL),
        '[]'
    )                                                                   AS observers
FROM salon_tables st
LEFT JOIN clubs c           ON st.club_id = c.id
LEFT JOIN table_seats ts    ON st.id = ts.table_id
LEFT JOIN users us          ON ts.user_id = us.id
LEFT JOIN table_observers to2 ON st.id = to2.table_id
LEFT JOIN users uo          ON to2.user_id = uo.id
WHERE st.status <> 'closed'
GROUP BY st.id, st.name, st.status, st.min_bet, st.max_players, st.invite_token, c.name
ORDER BY st.id;

COMMENT ON VIEW v_salon_state IS
    'État temps réel du salon — 1 ligne par table ouverte avec joueurs et observateurs en JSONB';


-- =============================================================================
-- SECTION 7 : SEED — 10 TABLES INITIALES
-- Créées sans created_by (tables système) et sans club_id (globales)
-- invite_token généré automatiquement par le trigger
-- =============================================================================

INSERT INTO salon_tables (name, min_bet, max_players) VALUES
    ('Table 1',        100, 4),
    ('Table 2',        100, 4),
    ('Table 3',        100, 6),
    ('Table 4',        200, 4),
    ('Table 5',        200, 4),
    ('Table 6',        200, 6),
    ('Table 7',        500, 4),
    ('Table 8',        500, 6),
    ('Table 9',       1000, 4),
    ('Table VIP',     2000, 4);


-- =============================================================================
-- VÉRIFICATIONS POST-MIGRATION
-- Copier-coller ces requêtes dans Neon Console après exécution
-- =============================================================================

-- 1. Tables créées
-- SELECT id, name, min_bet, max_players, status, LEFT(invite_token,16)||'...' AS token
-- FROM salon_tables ORDER BY id;

-- 2. Vue salon fonctionnelle
-- SELECT table_id, table_name, status, seated_count, available_seats FROM v_salon_state;

-- 3. Contrainte d'exclusion — doit lever une exception :
-- INSERT INTO salon_tables (name, min_bet) VALUES ('Test', 0) RETURNING id;
-- -- noter l'id, ex: 11
-- INSERT INTO table_seats (table_id, user_id, seat_number) VALUES (11, 1, 1);
-- INSERT INTO table_observers (table_id, user_id) VALUES (11, 1);
-- -- Attendu : ERROR: Utilisateur 1 est déjà assis à la table 11


-- =============================================================================
-- ROLLBACK (exécuter uniquement en cas de problème)
-- =============================================================================

/*
BEGIN;
DROP VIEW  IF EXISTS v_salon_state;
DROP TABLE IF EXISTS table_observers CASCADE;
DROP TABLE IF EXISTS table_seats     CASCADE;
DROP TABLE IF EXISTS salon_tables    CASCADE;
DROP FUNCTION IF EXISTS fn_salon_table_invite_token();
DROP FUNCTION IF EXISTS fn_check_seat_observer_exclusion();
DROP TYPE  IF EXISTS salon_table_status;
COMMIT;
*/

COMMIT;

-- =============================================================================
-- FIN DE LA MIGRATION 002
-- =============================================================================
