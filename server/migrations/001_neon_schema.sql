-- =============================================================================
-- FAP FAP — Schéma PostgreSQL complet pour Neon
-- Généré le : 2026-06-15
-- Reconstruction depuis : reverse-engineering du code source + docs/
-- Source : MySQL fap_fap_db → PostgreSQL Neon
-- =============================================================================
-- Ordre d'exécution : ce fichier s'exécute de haut en bas dans psql ou Neon console
-- =============================================================================


-- =============================================================================
-- SECTION 1 : TYPES ÉNUMÉRÉS
-- =============================================================================

CREATE TYPE user_role         AS ENUM ('superadmin', 'katika', 'player');
CREATE TYPE user_status       AS ENUM ('active', 'suspended', 'inactive');
CREATE TYPE club_status       AS ENUM ('open', 'closed', 'suspended');
CREATE TYPE transaction_type  AS ENUM ('mise', 'gain', 'transfert', 'recharge', 'commission', 'remboursement');
CREATE TYPE transaction_status AS ENUM ('pending', 'confirmed', 'cancelled');
CREATE TYPE game_status       AS ENUM ('waiting', 'playing', 'finished', 'cancelled');
CREATE TYPE win_type          AS ENUM ('normal', 'koratte', 'carre', 'tchia', 'trois_sept', 'couleur', 'tous_banque');
CREATE TYPE player_result     AS ENUM ('winner', 'loser', 'banque', 'spectator');
CREATE TYPE commission_status AS ENUM ('pending', 'paid', 'disputed');
CREATE TYPE recharge_status   AS ENUM ('pending', 'approved', 'rejected');


-- =============================================================================
-- SECTION 2 : CREATE TABLE
-- (ordre : clubs avant users pour la FK deferrable ; game_sessions après les deux)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table : clubs
-- Créée avant users car users.club_id → clubs.id
-- La FK clubs.katika_id → users.id est ajoutée après users (DEFERRABLE)
-- -----------------------------------------------------------------------------
CREATE TABLE clubs (
    id              SERIAL          PRIMARY KEY,
    name            VARCHAR(100)    NOT NULL,
    katika_id       INTEGER         NOT NULL,
    stake_default   NUMERIC(10,2)   NOT NULL DEFAULT 500.00,
    max_players     SMALLINT        NOT NULL DEFAULT 4,
    commission_rate NUMERIC(5,4)    NOT NULL DEFAULT 0.0500,
    status          club_status     NOT NULL DEFAULT 'open',
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_clubs_max_players    CHECK (max_players BETWEEN 2 AND 8),
    CONSTRAINT chk_clubs_commission     CHECK (commission_rate BETWEEN 0 AND 1),
    CONSTRAINT chk_clubs_stake          CHECK (stake_default > 0)
);

COMMENT ON TABLE  clubs IS 'Clubs de jeu — chaque Katika gère un club';
COMMENT ON COLUMN clubs.stake_default   IS 'Mise par défaut de la table (FCFA) — était hardcodé à 500 dans server.js';
COMMENT ON COLUMN clubs.commission_rate IS '0.0500 = 5% prélevé par le Wali sur chaque pot';


-- -----------------------------------------------------------------------------
-- Table : users
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    id          SERIAL          PRIMARY KEY,
    username    VARCHAR(100)    NOT NULL,
    phone       VARCHAR(20)     NOT NULL,
    password    VARCHAR(255)    NOT NULL,
    role        user_role       NOT NULL DEFAULT 'player',
    wallet      NUMERIC(15,2)   NOT NULL DEFAULT 0.00,
    club_id     INTEGER         NULL,
    status      user_status     NOT NULL DEFAULT 'active',
    avatar_url  TEXT            NULL,
    last_login  TIMESTAMPTZ     NULL,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_users_phone   UNIQUE (phone),
    CONSTRAINT chk_wallet_pos   CHECK (wallet >= 0)
);

COMMENT ON TABLE  users IS 'Joueurs, Katikas et Wali (superadmin)';
COMMENT ON COLUMN users.phone       IS 'Identifiant de connexion unique (remplace username pour le login)';
COMMENT ON COLUMN users.wallet      IS 'Solde en FCFA — CHECK garantit >= 0 au niveau DB';
COMMENT ON COLUMN users.avatar_url  IS 'URL DiceBear ou upload — NULL si non défini';


-- FK croisées : clubs ↔ users (les deux tables existent maintenant)
ALTER TABLE clubs
    ADD CONSTRAINT fk_clubs_katika
    FOREIGN KEY (katika_id) REFERENCES users(id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE users
    ADD CONSTRAINT fk_users_club
    FOREIGN KEY (club_id) REFERENCES clubs(id)
    ON DELETE SET NULL;


-- -----------------------------------------------------------------------------
-- Table : game_sessions
-- Une partie complète (de "start-game" à "handleGameOver")
-- Remplace l'objet RAM tables["club_X"] de server.js
-- -----------------------------------------------------------------------------
CREATE TABLE game_sessions (
    id          SERIAL          PRIMARY KEY,
    club_id     INTEGER         NOT NULL,
    dealer_id   INTEGER         NOT NULL,
    winner_id   INTEGER         NULL,
    stake       NUMERIC(10,2)   NOT NULL,
    pot_total   NUMERIC(15,2)   NOT NULL DEFAULT 0.00,
    commission  NUMERIC(15,2)   NOT NULL DEFAULT 0.00,
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
    CONSTRAINT chk_gs_pot       CHECK (pot_total >= 0),
    CONSTRAINT chk_gs_commission CHECK (commission >= 0)
);

COMMENT ON TABLE  game_sessions IS 'Historique de chaque partie jouée — données auparavant perdues en RAM';
COMMENT ON COLUMN game_sessions.win_type IS 'NULL si partie annulée ; normal/koratte/carre/tchia/trois_sept/couleur/tous_banque';
COMMENT ON COLUMN game_sessions.commission IS 'commission_rate * pot_total prélevé pour le Wali';


-- -----------------------------------------------------------------------------
-- Table : transactions
-- Toutes les opérations financières (mises, gains, transferts, recharges...)
-- -----------------------------------------------------------------------------
CREATE TABLE transactions (
    id               SERIAL               PRIMARY KEY,
    user_id          INTEGER              NOT NULL,
    club_id          INTEGER              NULL,
    game_session_id  INTEGER              NULL,
    sender_id        INTEGER              NULL,
    amount           NUMERIC(15,2)        NOT NULL,
    balance_before   NUMERIC(15,2)        NOT NULL,
    balance_after    NUMERIC(15,2)        NOT NULL,
    type             transaction_type     NOT NULL,
    status           transaction_status   NOT NULL DEFAULT 'confirmed',
    note             VARCHAR(255)         NULL,
    created_at       TIMESTAMPTZ          NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_tx_user       FOREIGN KEY (user_id)         REFERENCES users(id),
    CONSTRAINT fk_tx_club       FOREIGN KEY (club_id)         REFERENCES clubs(id),
    CONSTRAINT fk_tx_session    FOREIGN KEY (game_session_id) REFERENCES game_sessions(id) ON DELETE SET NULL,
    CONSTRAINT fk_tx_sender     FOREIGN KEY (sender_id)       REFERENCES users(id),
    CONSTRAINT chk_tx_amount    CHECK (amount <> 0),
    CONSTRAINT chk_tx_balance   CHECK (balance_after >= 0)
);

COMMENT ON TABLE  transactions IS 'Ledger financier immuable — chaque ligne est une opération atomique';
COMMENT ON COLUMN transactions.amount         IS 'Négatif pour débit (mise), positif pour crédit (gain)';
COMMENT ON COLUMN transactions.balance_before IS 'Solde avant opération — permet audit sans recalcul';
COMMENT ON COLUMN transactions.balance_after  IS 'Solde après opération — doit égaler balance_before + amount';
COMMENT ON COLUMN transactions.status         IS 'pending uniquement pour les recharges en attente d''approbation';


-- -----------------------------------------------------------------------------
-- Table : game_players
-- Qui a joué dans quelle partie, avec quel résultat
-- -----------------------------------------------------------------------------
CREATE TABLE game_players (
    id               SERIAL          PRIMARY KEY,
    game_session_id  INTEGER         NOT NULL,
    user_id          INTEGER         NOT NULL,
    stake_paid       NUMERIC(10,2)   NOT NULL,
    gain_received    NUMERIC(15,2)   NOT NULL DEFAULT 0.00,
    result           player_result   NOT NULL DEFAULT 'loser',
    cards_dealt      JSONB           NULL,
    final_cards      JSONB           NULL,
    joined_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_gp_session_player UNIQUE (game_session_id, user_id),
    CONSTRAINT fk_gp_session    FOREIGN KEY (game_session_id) REFERENCES game_sessions(id),
    CONSTRAINT fk_gp_user       FOREIGN KEY (user_id)         REFERENCES users(id),
    CONSTRAINT chk_gp_stake     CHECK (stake_paid > 0),
    CONSTRAINT chk_gp_gain      CHECK (gain_received >= 0)
);

COMMENT ON TABLE  game_players IS 'Participation de chaque joueur à une game_session';
COMMENT ON COLUMN game_players.cards_dealt  IS 'Main initiale distribuée — JSONB [{suit, value}, ...] — pour audit KORATTE/CARRÉ';
COMMENT ON COLUMN game_players.final_cards  IS 'Cartes finales si le joueur a PASSé — pour résolution litiges';
COMMENT ON COLUMN game_players.result       IS 'banque = sorti de la manche avant la fin';


-- -----------------------------------------------------------------------------
-- Table : game_rounds
-- Chaque pli joué dans une partie (pour rejeu complet et audit)
-- -----------------------------------------------------------------------------
CREATE TABLE game_rounds (
    id               SERIAL          PRIMARY KEY,
    game_session_id  INTEGER         NOT NULL,
    round_number     SMALLINT        NOT NULL,
    leader_id        INTEGER         NOT NULL,
    winner_id        INTEGER         NULL,
    cards_played     JSONB           NOT NULL,
    created_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_gr_session_round  UNIQUE (game_session_id, round_number),
    CONSTRAINT fk_gr_session    FOREIGN KEY (game_session_id) REFERENCES game_sessions(id),
    CONSTRAINT fk_gr_leader     FOREIGN KEY (leader_id)       REFERENCES users(id),
    CONSTRAINT fk_gr_winner     FOREIGN KEY (winner_id)       REFERENCES users(id),
    CONSTRAINT chk_gr_round     CHECK (round_number >= 1)
);

COMMENT ON TABLE  game_rounds IS 'Historique pli par pli — JSONB [{user_id, card:{suit,value}}]';
COMMENT ON COLUMN game_rounds.leader_id IS 'Joueur qui a mené le pli (joué en premier)';
COMMENT ON COLUMN game_rounds.winner_id IS 'NULL si pli non résolu (PASS en cours)';


-- -----------------------------------------------------------------------------
-- Table : commissions
-- Prélèvements Wali sur chaque pot finalisé
-- -----------------------------------------------------------------------------
CREATE TABLE commissions (
    id               SERIAL               PRIMARY KEY,
    game_session_id  INTEGER              NOT NULL,
    club_id          INTEGER              NOT NULL,
    wali_id          INTEGER              NOT NULL,
    katika_id        INTEGER              NOT NULL,
    pot_total        NUMERIC(15,2)        NOT NULL,
    rate             NUMERIC(5,4)         NOT NULL,
    amount           NUMERIC(15,2)        NOT NULL,
    status           commission_status    NOT NULL DEFAULT 'pending',
    paid_at          TIMESTAMPTZ          NULL,
    created_at       TIMESTAMPTZ          NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_com_session   FOREIGN KEY (game_session_id) REFERENCES game_sessions(id),
    CONSTRAINT fk_com_club      FOREIGN KEY (club_id)         REFERENCES clubs(id),
    CONSTRAINT fk_com_wali      FOREIGN KEY (wali_id)         REFERENCES users(id),
    CONSTRAINT fk_com_katika    FOREIGN KEY (katika_id)       REFERENCES users(id),
    CONSTRAINT chk_com_amount   CHECK (amount > 0),
    CONSTRAINT chk_com_rate     CHECK (rate > 0 AND rate <= 1)
);

COMMENT ON TABLE  commissions IS 'Commissions dues au Wali sur chaque partie terminée';
COMMENT ON COLUMN commissions.amount IS 'pot_total * rate — calculé et inséré par handleGameOver()';


-- -----------------------------------------------------------------------------
-- Table : recharge_requests
-- Workflow de demande de recharge wallet (remplace le stub /api/money/recharge)
-- -----------------------------------------------------------------------------
CREATE TABLE recharge_requests (
    id           SERIAL           PRIMARY KEY,
    requester_id INTEGER          NOT NULL,
    target_id    INTEGER          NOT NULL,
    amount       NUMERIC(15,2)    NOT NULL,
    status       recharge_status  NOT NULL DEFAULT 'pending',
    reviewed_by  INTEGER          NULL,
    reviewed_at  TIMESTAMPTZ      NULL,
    note         VARCHAR(500)     NULL,
    created_at   TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_rr_requester  FOREIGN KEY (requester_id) REFERENCES users(id),
    CONSTRAINT fk_rr_target     FOREIGN KEY (target_id)    REFERENCES users(id),
    CONSTRAINT fk_rr_reviewer   FOREIGN KEY (reviewed_by)  REFERENCES users(id),
    CONSTRAINT chk_rr_amount    CHECK (amount > 0)
);

COMMENT ON TABLE  recharge_requests IS 'Demandes de recharge wallet — Katika → joueur, ou Katika → Wali';


-- -----------------------------------------------------------------------------
-- Table : audit_logs
-- Traçabilité de toutes les actions sensibles (BIGSERIAL : volume élevé prévu)
-- -----------------------------------------------------------------------------
CREATE TABLE audit_logs (
    id          BIGSERIAL       PRIMARY KEY,
    user_id     INTEGER         NULL,
    action      VARCHAR(100)    NOT NULL,
    entity_type VARCHAR(50)     NULL,
    entity_id   INTEGER         NULL,
    old_value   JSONB           NULL,
    new_value   JSONB           NULL,
    ip_address  INET            NULL,
    user_agent  TEXT            NULL,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_al_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

COMMENT ON TABLE  audit_logs IS 'Log immuable de toutes les actions sensibles — BIGSERIAL car volume élevé';
COMMENT ON COLUMN audit_logs.ip_address IS 'Type INET natif PostgreSQL (supporte IPv4 et IPv6)';
COMMENT ON COLUMN audit_logs.action     IS 'login | logout | create_katika | create_player | transfer | recharge_approve | game_start | game_end | wallet_change | status_change';


-- =============================================================================
-- SECTION 3 : INDEX
-- =============================================================================

-- users
CREATE INDEX idx_users_phone        ON users(phone);
CREATE INDEX idx_users_club_id      ON users(club_id);
CREATE INDEX idx_users_role         ON users(role);
CREATE INDEX idx_users_status       ON users(status);

-- clubs
CREATE INDEX idx_clubs_katika_id    ON clubs(katika_id);
CREATE INDEX idx_clubs_status       ON clubs(status);

-- game_sessions
CREATE INDEX idx_gs_club_id         ON game_sessions(club_id);
CREATE INDEX idx_gs_dealer_id       ON game_sessions(dealer_id);
CREATE INDEX idx_gs_winner_id       ON game_sessions(winner_id);
CREATE INDEX idx_gs_status          ON game_sessions(status);
CREATE INDEX idx_gs_created_at      ON game_sessions(created_at DESC);

-- transactions (requêtes fréquentes : historique joueur, rapport Wali)
CREATE INDEX idx_tx_user_id         ON transactions(user_id);
CREATE INDEX idx_tx_session_id      ON transactions(game_session_id);
CREATE INDEX idx_tx_created_at      ON transactions(created_at DESC);
CREATE INDEX idx_tx_type            ON transactions(type);
CREATE INDEX idx_tx_user_date       ON transactions(user_id, created_at DESC);
CREATE INDEX idx_tx_status          ON transactions(status) WHERE status = 'pending';

-- game_players
CREATE INDEX idx_gp_user_id         ON game_players(user_id);
CREATE INDEX idx_gp_session_id      ON game_players(game_session_id);
CREATE INDEX idx_gp_result          ON game_players(result);

-- game_rounds
CREATE INDEX idx_gr_session_id      ON game_rounds(game_session_id);

-- commissions
CREATE INDEX idx_com_session_id     ON commissions(game_session_id);
CREATE INDEX idx_com_wali_id        ON commissions(wali_id);
CREATE INDEX idx_com_status         ON commissions(status);

-- recharge_requests
CREATE INDEX idx_rr_requester       ON recharge_requests(requester_id);
CREATE INDEX idx_rr_target          ON recharge_requests(target_id);
CREATE INDEX idx_rr_status          ON recharge_requests(status) WHERE status = 'pending';

-- audit_logs (lectures par user ou par plage de dates)
CREATE INDEX idx_al_user_id         ON audit_logs(user_id);
CREATE INDEX idx_al_action          ON audit_logs(action);
CREATE INDEX idx_al_created_at      ON audit_logs(created_at DESC);
CREATE INDEX idx_al_entity          ON audit_logs(entity_type, entity_id);


-- =============================================================================
-- SECTION 4 : TRIGGERS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Trigger 1 : updated_at automatique (users et clubs)
-- PostgreSQL n'a pas ON UPDATE CURRENT_TIMESTAMP — nécessite un trigger
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_clubs_updated_at
    BEFORE UPDATE ON clubs
    FOR EACH ROW
    EXECUTE FUNCTION fn_set_updated_at();


-- -----------------------------------------------------------------------------
-- Trigger 2 : Cohérence balance_before + amount = balance_after
-- Bloque à l'insertion toute transaction mathématiquement incohérente
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_validate_transaction_balance()
RETURNS TRIGGER AS $$
BEGIN
    IF ABS((NEW.balance_before + NEW.amount) - NEW.balance_after) > 0.005 THEN
        RAISE EXCEPTION
            'Incohérence financière : balance_before (%) + amount (%) ≠ balance_after (%). Diff = %',
            NEW.balance_before, NEW.amount, NEW.balance_after,
            (NEW.balance_before + NEW.amount) - NEW.balance_after;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tx_validate_balance
    BEFORE INSERT ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION fn_validate_transaction_balance();


-- -----------------------------------------------------------------------------
-- Trigger 3 : Immuabilité des transactions (montants non modifiables)
-- Une transaction insérée ne peut pas voir ses montants modifiés
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_protect_transaction_amounts()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.amount         <> NEW.amount         OR
       OLD.balance_before <> NEW.balance_before OR
       OLD.balance_after  <> NEW.balance_after  THEN
        RAISE EXCEPTION
            'Les montants d''une transaction sont immuables (id=%). Créer une transaction corrective.',
            OLD.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tx_immutable_amounts
    BEFORE UPDATE ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION fn_protect_transaction_amounts();


-- -----------------------------------------------------------------------------
-- Trigger 4 : Audit automatique des changements sensibles sur users
-- Toute modification de wallet, status ou role est journalisée dans audit_logs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_audit_user_changes()
RETURNS TRIGGER AS $$
DECLARE
    v_action VARCHAR(50);
BEGIN
    IF OLD.wallet <> NEW.wallet THEN
        v_action := 'wallet_change';
    ELSIF OLD.status <> NEW.status THEN
        v_action := 'status_change';
    ELSIF OLD.role <> NEW.role THEN
        v_action := 'role_change';
    ELSE
        v_action := 'user_update';
    END IF;

    IF OLD.wallet <> NEW.wallet OR OLD.status <> NEW.status OR OLD.role <> NEW.role THEN
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_value, new_value)
        VALUES (
            NEW.id,
            v_action,
            'user',
            NEW.id,
            jsonb_build_object(
                'wallet', OLD.wallet,
                'status', OLD.status::text,
                'role',   OLD.role::text
            ),
            jsonb_build_object(
                'wallet', NEW.wallet,
                'status', NEW.status::text,
                'role',   NEW.role::text
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_audit_changes
    AFTER UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION fn_audit_user_changes();


-- -----------------------------------------------------------------------------
-- Trigger 5 : Calcul automatique de la commission à la fin d'une partie
-- Insère une ligne dans commissions quand game_sessions.status passe à 'finished'
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_auto_insert_commission()
RETURNS TRIGGER AS $$
DECLARE
    v_katika_id INTEGER;
    v_wali_id   INTEGER;
    v_rate      NUMERIC(5,4);
    v_amount    NUMERIC(15,2);
BEGIN
    IF OLD.status <> 'finished' AND NEW.status = 'finished' AND NEW.winner_id IS NOT NULL THEN
        SELECT c.katika_id, c.commission_rate
        INTO   v_katika_id, v_rate
        FROM   clubs c
        WHERE  c.id = NEW.club_id;

        SELECT id INTO v_wali_id
        FROM   users
        WHERE  role = 'superadmin'
        LIMIT  1;

        v_amount := NEW.pot_total * v_rate;

        IF v_amount > 0 THEN
            INSERT INTO commissions (
                game_session_id, club_id, wali_id, katika_id,
                pot_total, rate, amount, status
            ) VALUES (
                NEW.id, NEW.club_id, v_wali_id, v_katika_id,
                NEW.pot_total, v_rate, v_amount, 'pending'
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_gs_auto_commission
    AFTER UPDATE ON game_sessions
    FOR EACH ROW
    EXECUTE FUNCTION fn_auto_insert_commission();


-- =============================================================================
-- SECTION 5 : VUES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Vue 1 : Statistiques joueur — winrate, FCFA misé / gagné / net
-- -----------------------------------------------------------------------------
CREATE VIEW v_player_stats AS
SELECT
    u.id,
    u.username,
    u.phone,
    u.wallet,
    u.status,
    c.name                                                                              AS club_name,
    COUNT(DISTINCT gp.game_session_id)                                                  AS total_games,
    COUNT(DISTINCT gp.game_session_id) FILTER (WHERE gp.result = 'winner')              AS games_won,
    COALESCE(SUM(gp.stake_paid), 0)                                                     AS total_staked,
    COALESCE(SUM(gp.gain_received), 0)                                                  AS total_gained,
    COALESCE(SUM(gp.gain_received) - SUM(gp.stake_paid), 0)                            AS net_result,
    CASE
        WHEN COUNT(DISTINCT gp.game_session_id) = 0 THEN 0
        ELSE ROUND(
            100.0
            * COUNT(DISTINCT gp.game_session_id) FILTER (WHERE gp.result = 'winner')
            / COUNT(DISTINCT gp.game_session_id),
            2
        )
    END                                                                                 AS winrate_pct
FROM users u
LEFT JOIN clubs c       ON u.club_id = c.id
LEFT JOIN game_players gp ON u.id = gp.user_id
LEFT JOIN game_sessions gs ON gp.game_session_id = gs.id AND gs.status = 'finished'
WHERE u.role = 'player'
GROUP BY u.id, u.username, u.phone, u.wallet, u.status, c.name;

COMMENT ON VIEW v_player_stats IS 'Statistiques par joueur : winrate, volume misé, solde net';


-- -----------------------------------------------------------------------------
-- Vue 2 : Activité par club — pour le dashboard Wali
-- -----------------------------------------------------------------------------
CREATE VIEW v_club_activity AS
SELECT
    c.id,
    c.name,
    ck.username                                                                         AS katika_name,
    ck.phone                                                                            AS katika_phone,
    c.stake_default,
    c.commission_rate,
    c.status,
    COUNT(DISTINCT p.id)                                                                AS player_count,
    COUNT(DISTINCT gs.id)                                                               AS total_games,
    COUNT(DISTINCT gs.id) FILTER (WHERE gs.status = 'finished')                        AS finished_games,
    COALESCE(SUM(gs.pot_total) FILTER (WHERE gs.status = 'finished'), 0)               AS total_volume_fcfa,
    COALESCE(SUM(com.amount)   FILTER (WHERE com.status = 'paid'),    0)               AS commissions_paid,
    COALESCE(SUM(com.amount)   FILTER (WHERE com.status = 'pending'), 0)               AS commissions_pending
FROM clubs c
JOIN users ck       ON c.katika_id = ck.id
LEFT JOIN users p   ON p.club_id = c.id AND p.role = 'player'
LEFT JOIN game_sessions gs  ON c.id = gs.club_id
LEFT JOIN commissions com   ON c.id = com.club_id
GROUP BY c.id, c.name, ck.username, ck.phone, c.stake_default, c.commission_rate, c.status;

COMMENT ON VIEW v_club_activity IS 'Tableau de bord Wali : volume et commissions par club';


-- -----------------------------------------------------------------------------
-- Vue 3 : Commissions en attente — dashboard Wali
-- -----------------------------------------------------------------------------
CREATE VIEW v_pending_commissions AS
SELECT
    com.id,
    com.created_at,
    gs.id                   AS game_session_id,
    c.name                  AS club_name,
    uw.username             AS wali_username,
    uk.username             AS katika_username,
    com.pot_total,
    com.rate,
    com.amount,
    com.status
FROM commissions com
JOIN game_sessions gs   ON com.game_session_id = gs.id
JOIN clubs c            ON com.club_id = c.id
JOIN users uw           ON com.wali_id = uw.id
JOIN users uk           ON com.katika_id = uk.id
WHERE com.status = 'pending'
ORDER BY com.created_at DESC;

COMMENT ON VIEW v_pending_commissions IS 'Commissions dues au Wali non encore payées';


-- -----------------------------------------------------------------------------
-- Vue 4 : Historique de wallet par joueur — avec contexte transaction
-- -----------------------------------------------------------------------------
CREATE VIEW v_wallet_history AS
SELECT
    t.id,
    t.created_at,
    u.id                    AS user_id,
    u.username,
    t.type,
    t.amount,
    t.balance_before,
    t.balance_after,
    t.status,
    t.note,
    gs.id                   AS game_session_id,
    c.name                  AS club_name,
    s.username              AS sender_username
FROM transactions t
JOIN users u            ON t.user_id = u.id
LEFT JOIN game_sessions gs  ON t.game_session_id = gs.id
LEFT JOIN clubs c           ON t.club_id = c.id
LEFT JOIN users s           ON t.sender_id = s.id
ORDER BY t.user_id, t.created_at DESC;

COMMENT ON VIEW v_wallet_history IS 'Toutes les transactions avec contexte — pour audit et historique joueur';


-- -----------------------------------------------------------------------------
-- Vue 5 : Résumé de partie — pour rejeu et résolution de litiges
-- -----------------------------------------------------------------------------
CREATE VIEW v_game_summary AS
SELECT
    gs.id                                                                       AS game_id,
    gs.created_at,
    gs.started_at,
    gs.finished_at,
    CASE
        WHEN gs.finished_at IS NOT NULL AND gs.started_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (gs.finished_at - gs.started_at))::INTEGER
        ELSE NULL
    END                                                                         AS duration_seconds,
    c.name                                                                      AS club_name,
    ud.username                                                                 AS dealer_name,
    uw.username                                                                 AS winner_name,
    gs.win_type,
    gs.stake,
    gs.pot_total,
    gs.commission,
    gs.nb_players,
    gs.status
FROM game_sessions gs
JOIN clubs c        ON gs.club_id = c.id
JOIN users ud       ON gs.dealer_id = ud.id
LEFT JOIN users uw  ON gs.winner_id = uw.id;

COMMENT ON VIEW v_game_summary IS 'Résumé lisible de chaque partie — durée calculée';


-- -----------------------------------------------------------------------------
-- Vue 6 : Demandes de recharge en attente
-- -----------------------------------------------------------------------------
CREATE VIEW v_pending_recharges AS
SELECT
    rr.id,
    rr.created_at,
    ur.username             AS requester_name,
    ur.role                 AS requester_role,
    ut.username             AS target_name,
    ut.wallet               AS target_current_wallet,
    rr.amount,
    rr.note
FROM recharge_requests rr
JOIN users ur   ON rr.requester_id = ur.id
JOIN users ut   ON rr.target_id = ut.id
WHERE rr.status = 'pending'
ORDER BY rr.created_at ASC;

COMMENT ON VIEW v_pending_recharges IS 'File d''attente des demandes de recharge (FIFO)';


-- =============================================================================
-- SECTION 6 : DONNÉES INITIALES (seed Wali)
-- Reproduit init_db.js — le mot de passe doit être hashé par Node.js avant insertion
-- =============================================================================

-- IMPORTANT : remplacer <BCRYPT_HASH_ICI> par le résultat de :
--   node -e "const b = require('bcryptjs'); b.hash(process.env.WALI_INITIAL_PASSWORD, 10).then(console.log)"

-- Club principal (id=1)
INSERT INTO clubs (id, name, katika_id, stake_default, commission_rate, status)
VALUES (1, 'Club Principal', 1, 500.00, 0.0500, 'open')
ON CONFLICT DO NOTHING;

-- Wali Sylver (id=1, superadmin)
INSERT INTO users (id, username, phone, password, role, wallet, club_id, status)
VALUES (
    1,
    'Wali Sylver',
    '0700000001',
    '<BCRYPT_HASH_ICI>',
    'superadmin',
    1000000.00,
    1,
    'active'
)
ON CONFLICT DO NOTHING;

-- Mise à jour des séquences après insert avec IDs fixes
SELECT setval('clubs_id_seq', (SELECT COALESCE(MAX(id), 1) FROM clubs));
SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id), 1) FROM users));


-- =============================================================================
-- SECTION 7 : MIGRATION DEPUIS MySQL
-- =============================================================================
-- Ce bloc s'exécute dans une transaction séparée après export des données MySQL.
-- Export MySQL recommandé : mysqldump --compatible=postgresql ou via DBeaver / pgloader
-- =============================================================================

/*
-- ─────────────────────────────────────────────────────────────────────────────
-- ÉTAPE 7-A : Tables temporaires d'import (CSV)
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TEMP TABLE _import_clubs (
    id          INTEGER,
    name        TEXT,
    katika_id   INTEGER,
    created_at  TEXT  -- on normalise en TIMESTAMPTZ plus bas
);

CREATE TEMP TABLE _import_users (
    id          INTEGER,
    username    TEXT,
    phone       TEXT,
    password    TEXT,
    role        TEXT,
    wallet      NUMERIC(15,2),
    club_id     INTEGER,
    created_at  TEXT
);

CREATE TEMP TABLE _import_transactions (
    id          INTEGER,
    user_id     INTEGER,
    club_id     INTEGER,
    amount      NUMERIC(15,2),
    type        TEXT,
    sender_id   INTEGER,
    created_at  TEXT
);

-- ─────────────────────────────────────────────────────────────────────────────
-- ÉTAPE 7-B : Charger les CSV depuis psql
-- ─────────────────────────────────────────────────────────────────────────────
-- \copy _import_clubs        FROM '/tmp/clubs.csv'        WITH (FORMAT csv, HEADER true);
-- \copy _import_users        FROM '/tmp/users.csv'        WITH (FORMAT csv, HEADER true);
-- \copy _import_transactions FROM '/tmp/transactions.csv' WITH (FORMAT csv, HEADER true);

-- ─────────────────────────────────────────────────────────────────────────────
-- ÉTAPE 7-C : Insérer les clubs (ordre 1 : pas de FK encore résolue)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO clubs (id, name, katika_id, created_at)
SELECT
    id,
    name,
    katika_id,
    TO_TIMESTAMP(created_at, 'YYYY-MM-DD HH24:MI:SS') AT TIME ZONE 'UTC'
FROM _import_clubs
ON CONFLICT (id) DO NOTHING;

SELECT setval('clubs_id_seq', (SELECT MAX(id) FROM clubs));

-- ─────────────────────────────────────────────────────────────────────────────
-- ÉTAPE 7-D : Insérer les users
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO users (id, username, phone, password, role, wallet, club_id, created_at)
SELECT
    id,
    username,
    phone,
    password,
    role::user_role,
    wallet,
    NULLIF(club_id, 0),
    TO_TIMESTAMP(created_at, 'YYYY-MM-DD HH24:MI:SS') AT TIME ZONE 'UTC'
FROM _import_users
ON CONFLICT (id) DO NOTHING;

SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));

-- ─────────────────────────────────────────────────────────────────────────────
-- ÉTAPE 7-E : Reconstruire balance_before / balance_after depuis MySQL
-- MySQL n'avait pas ces colonnes — on les recalcule par window function.
-- Hypothèse : wallet courant = somme de toutes les transactions passées + solde initial
-- ─────────────────────────────────────────────────────────────────────────────
WITH
-- Somme totale des transactions pour chaque user
user_tx_sum AS (
    SELECT user_id, SUM(amount) AS total_amount
    FROM _import_transactions
    GROUP BY user_id
),
-- Solde initial = wallet actuel - somme de toutes les transactions
user_initial_balance AS (
    SELECT
        u.id AS user_id,
        u.wallet - COALESCE(uts.total_amount, 0) AS initial_balance
    FROM users u
    LEFT JOIN user_tx_sum uts ON u.id = uts.user_id
),
-- Running sum ordonné par date
ordered_tx AS (
    SELECT
        t.*,
        ROW_NUMBER() OVER (PARTITION BY t.user_id ORDER BY t.created_at, t.id) AS rn,
        SUM(t.amount) OVER (
            PARTITION BY t.user_id
            ORDER BY t.created_at, t.id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ) AS cum_before,
        SUM(t.amount) OVER (
            PARTITION BY t.user_id
            ORDER BY t.created_at, t.id
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS cum_after
    FROM _import_transactions t
)
INSERT INTO transactions (
    id, user_id, club_id, sender_id,
    amount, balance_before, balance_after,
    type, status, created_at
)
SELECT
    ot.id,
    ot.user_id,
    NULLIF(ot.club_id, 0),
    NULLIF(ot.sender_id, 0),
    ot.amount,
    uib.initial_balance + COALESCE(ot.cum_before, 0),
    uib.initial_balance + ot.cum_after,
    CASE ot.type
        WHEN 'mise'      THEN 'mise'::transaction_type
        WHEN 'gain'      THEN 'gain'::transaction_type
        WHEN 'transfert' THEN 'transfert'::transaction_type
        ELSE 'transfert'::transaction_type
    END,
    'confirmed'::transaction_status,
    TO_TIMESTAMP(ot.created_at, 'YYYY-MM-DD HH24:MI:SS') AT TIME ZONE 'UTC'
FROM ordered_tx ot
JOIN user_initial_balance uib ON ot.user_id = uib.user_id
ON CONFLICT (id) DO NOTHING;

SELECT setval('transactions_id_seq', (SELECT MAX(id) FROM transactions));

COMMIT;

*/
-- ─────────────────────────────────────────────────────────────────────────────
-- FIN DE LA MIGRATION
-- Vérifier ensuite :
--   SELECT COUNT(*) FROM users;
--   SELECT COUNT(*) FROM clubs;
--   SELECT COUNT(*) FROM transactions;
--   SELECT * FROM v_wallet_history LIMIT 20;
-- ─────────────────────────────────────────────────────────────────────────────
