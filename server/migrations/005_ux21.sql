-- =============================================================================
-- FAP FAP 2.1 — Migration 005 : UX 2.1, Académie, Multi-pays, Annonces
-- Date       : 2026-06-26
-- Dépend de  : 001_neon_schema.sql, 002_salon.sql, 003_sprint6.sql, 004_notifications.sql
-- Réversible : voir SECTION ROLLBACK en bas de fichier
-- =============================================================================
-- Exécuter depuis Neon Console → SQL Editor, ou :
--   node server/run_migration_005.js
-- =============================================================================

BEGIN;

-- =============================================================================
-- SECTION 1 : DEVISES (multi-pays)
-- =============================================================================

CREATE TABLE currencies (
    code         VARCHAR(10)   PRIMARY KEY,
    symbol       VARCHAR(5)    NOT NULL,
    country_code VARCHAR(3)    NOT NULL,
    country_name VARCHAR(100)  NOT NULL,
    is_active    BOOLEAN       NOT NULL DEFAULT true
);

COMMENT ON TABLE currencies IS 'Devises réelles par pays — la devise JETONS est interne et non listée ici';

INSERT INTO currencies (code, symbol, country_code, country_name) VALUES
    ('FCFA', 'F',   'CI', 'Côte d''Ivoire'),
    ('XOF',  'F',   'SN', 'Sénégal'),
    ('GHS',  '₵',   'GH', 'Ghana'),
    ('NGN',  '₦',   'NG', 'Nigeria'),
    ('EUR',  '€',   'FR', 'France');

-- =============================================================================
-- SECTION 2 : CLUBS — support multi-pays
-- =============================================================================

ALTER TABLE clubs
    ADD COLUMN IF NOT EXISTS currency_code VARCHAR(10) NOT NULL DEFAULT 'FCFA'
        REFERENCES currencies(code),
    ADD COLUMN IF NOT EXISTS country_code  VARCHAR(3)  NOT NULL DEFAULT 'CI',
    ADD COLUMN IF NOT EXISTS timezone      VARCHAR(50) NOT NULL DEFAULT 'Africa/Abidjan';

COMMENT ON COLUMN clubs.currency_code IS 'Devise utilisée par ce club pour les mises réelles';
COMMENT ON COLUMN clubs.country_code  IS 'Code ISO 3166-1 alpha-2 du pays du club';
COMMENT ON COLUMN clubs.timezone      IS 'Fuseau horaire IANA du club (affichage heures locales)';

-- =============================================================================
-- SECTION 3 : USERS — Nom/Prénom + niveau de progression
-- =============================================================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS first_name VARCHAR(100) NULL,
    ADD COLUMN IF NOT EXISTS last_name  VARCHAR(100) NULL,
    ADD COLUMN IF NOT EXISTS user_tier  VARCHAR(20)  NOT NULL DEFAULT 'registered'
        CHECK (user_tier IN ('visitor','observer','registered','academy','real','tournament','masters'));

COMMENT ON COLUMN users.first_name IS 'Prénom réel (optionnel — le sobriquet username reste l''identifiant en jeu)';
COMMENT ON COLUMN users.last_name  IS 'Nom de famille réel (optionnel)';
COMMENT ON COLUMN users.user_tier  IS 'Niveau de progression : visitor → observer → registered → academy → real → tournament → masters';

CREATE INDEX IF NOT EXISTS idx_users_tier ON users(user_tier);

-- =============================================================================
-- SECTION 4 : SALON_TABLES — type de table + niveau académie
-- =============================================================================

ALTER TABLE salon_tables
    ADD COLUMN IF NOT EXISTS table_type    VARCHAR(20) NOT NULL DEFAULT 'real'
        CHECK (table_type IN ('academy', 'real', 'tournament', 'private', 'vip')),
    ADD COLUMN IF NOT EXISTS currency      VARCHAR(10) NOT NULL DEFAULT 'FCFA',
    ADD COLUMN IF NOT EXISTS academy_level VARCHAR(20) NULL
        CHECK (academy_level IN ('beginner', 'confirmed', 'expert'));

COMMENT ON COLUMN salon_tables.table_type    IS 'academy | real | tournament | private | vip';
COMMENT ON COLUMN salon_tables.currency      IS 'FCFA pour les tables réelles, JETONS pour académie';
COMMENT ON COLUMN salon_tables.academy_level IS 'beginner=200J / confirmed=500J / expert=1000J — NULL pour les tables réelles';

CREATE INDEX IF NOT EXISTS idx_salon_tables_type  ON salon_tables(table_type);
CREATE INDEX IF NOT EXISTS idx_salon_tables_level ON salon_tables(academy_level) WHERE academy_level IS NOT NULL;

-- Tables Académie initiales (6 tables, 2 par niveau)
INSERT INTO salon_tables (name, min_bet, max_players, table_type, currency, academy_level)
SELECT name, min_bet, 4, 'academy', 'JETONS', academy_level
FROM (VALUES
    ('Académie Débutant 1',   200, 'beginner'),
    ('Académie Débutant 2',   200, 'beginner'),
    ('Académie Confirmé 1',   500, 'confirmed'),
    ('Académie Confirmé 2',   500, 'confirmed'),
    ('Académie Expert 1',    1000, 'expert'),
    ('Académie Expert 2',    1000, 'expert')
) AS t(name, min_bet, academy_level)
WHERE NOT EXISTS (
    SELECT 1 FROM salon_tables WHERE table_type = 'academy'
);

-- =============================================================================
-- SECTION 5 : ACADEMY_WALLETS
-- Portefeuille JETONS — séparé et non convertible en FCFA
-- =============================================================================

CREATE TABLE IF NOT EXISTS academy_wallets (
    id                SERIAL          PRIMARY KEY,
    user_id           INTEGER         NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

    -- Solde courant
    balance           NUMERIC(15,2)   NOT NULL DEFAULT 10000,

    -- Grant quotidien
    last_daily_grant  TIMESTAMPTZ     NULL,
    total_granted     NUMERIC(15,2)   NOT NULL DEFAULT 10000,

    -- Statistiques de progression
    games_played      INTEGER         NOT NULL DEFAULT 0,
    games_won         INTEGER         NOT NULL DEFAULT 0,
    games_lost        INTEGER         NOT NULL DEFAULT 0,
    total_won         NUMERIC(15,2)   NOT NULL DEFAULT 0,
    total_lost        NUMERIC(15,2)   NOT NULL DEFAULT 0,
    current_streak    INTEGER         NOT NULL DEFAULT 0,
    best_streak       INTEGER         NOT NULL DEFAULT 0,

    created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_acw_balance CHECK (balance >= 0),
    CONSTRAINT chk_acw_counts  CHECK (games_played = games_won + games_lost)
);

COMMENT ON TABLE  academy_wallets IS 'Portefeuille JETONS Académie — une ligne par joueur inscrit, créée à l''inscription';
COMMENT ON COLUMN academy_wallets.balance        IS 'Solde courant en JETONS';
COMMENT ON COLUMN academy_wallets.last_daily_grant IS 'Horodatage du dernier crédit quotidien (limite 1 fois / 24h)';
COMMENT ON COLUMN academy_wallets.current_streak IS 'Positif = série de victoires, négatif = série de défaites';
COMMENT ON COLUMN academy_wallets.best_streak    IS 'Meilleure série de victoires consécutives (toujours positif)';

CREATE INDEX IF NOT EXISTS idx_acw_user_id    ON academy_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_acw_last_grant ON academy_wallets(last_daily_grant);
CREATE INDEX IF NOT EXISTS idx_acw_games_won  ON academy_wallets(games_won DESC);

CREATE TRIGGER trg_acw_updated_at
    BEFORE UPDATE ON academy_wallets
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- =============================================================================
-- SECTION 6 : ACADEMY_TRANSACTIONS
-- Historique immuable de toutes les opérations sur les JETONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS academy_transactions (
    id                SERIAL          PRIMARY KEY,
    user_id           INTEGER         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transaction_type  VARCHAR(30)     NOT NULL
        CHECK (transaction_type IN (
            'INITIAL_GRANT',
            'DAILY_GRANT',
            'VICTORY',
            'DEFEAT',
            'TOURNAMENT_REWARD',
            'ADMIN_GRANT',
            'ADMIN_DEBIT',
            'EVENT_REWARD',
            'BONUS'
        )),
    amount            NUMERIC(15,2)   NOT NULL,
    balance_before    NUMERIC(15,2)   NOT NULL,
    balance_after     NUMERIC(15,2)   NOT NULL,
    reference         VARCHAR(200)    NULL,
    game_session_id   INTEGER         NULL REFERENCES game_sessions(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  academy_transactions IS 'Historique immuable de toutes les opérations JETONS — ne jamais faire de UPDATE ici';
COMMENT ON COLUMN academy_transactions.amount          IS 'Positif = crédit, négatif = débit';
COMMENT ON COLUMN academy_transactions.reference       IS 'Texte libre : "Partie #42", "Daily 2026-06-26", etc.';
COMMENT ON COLUMN academy_transactions.game_session_id IS 'Lien vers la partie si transaction issue d''un jeu';

CREATE INDEX IF NOT EXISTS idx_act_user_created ON academy_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_act_type         ON academy_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_act_created      ON academy_transactions(created_at DESC);

-- =============================================================================
-- SECTION 7 : VUES — CLASSEMENTS ACADÉMIE
-- =============================================================================

CREATE OR REPLACE VIEW v_academy_leaderboard_week AS
SELECT
    u.id,
    u.username,
    COALESCE(SUM(CASE WHEN at2.transaction_type = 'VICTORY' THEN at2.amount ELSE 0 END), 0) AS week_won,
    COUNT(CASE WHEN at2.transaction_type = 'VICTORY' THEN 1 END)                             AS week_victories,
    COUNT(CASE WHEN at2.transaction_type IN ('VICTORY','DEFEAT') THEN 1 END)                 AS week_games
FROM users u
LEFT JOIN academy_transactions at2
    ON at2.user_id = u.id
    AND at2.created_at >= date_trunc('week', NOW())
WHERE u.role = 'player'
GROUP BY u.id, u.username
ORDER BY week_won DESC;

COMMENT ON VIEW v_academy_leaderboard_week IS 'Classement Académie — semaine en cours (lundi à dimanche)';

CREATE OR REPLACE VIEW v_academy_leaderboard_month AS
SELECT
    u.id,
    u.username,
    COALESCE(SUM(CASE WHEN at2.transaction_type = 'VICTORY' THEN at2.amount ELSE 0 END), 0) AS month_won,
    COUNT(CASE WHEN at2.transaction_type = 'VICTORY' THEN 1 END)                             AS month_victories,
    COUNT(CASE WHEN at2.transaction_type IN ('VICTORY','DEFEAT') THEN 1 END)                 AS month_games
FROM users u
LEFT JOIN academy_transactions at2
    ON at2.user_id = u.id
    AND at2.created_at >= date_trunc('month', NOW())
WHERE u.role = 'player'
GROUP BY u.id, u.username
ORDER BY month_won DESC;

COMMENT ON VIEW v_academy_leaderboard_month IS 'Classement Académie — mois en cours';

CREATE OR REPLACE VIEW v_academy_leaderboard_alltime AS
SELECT
    u.id,
    u.username,
    aw.games_won,
    aw.games_played,
    aw.games_lost,
    aw.total_won,
    aw.best_streak,
    aw.balance                                                                AS current_balance,
    ROUND(
        aw.games_won::NUMERIC / NULLIF(aw.games_played, 0) * 100, 1
    )                                                                         AS win_rate
FROM academy_wallets aw
JOIN users u ON u.id = aw.user_id
ORDER BY aw.games_won DESC;

COMMENT ON VIEW v_academy_leaderboard_alltime IS 'Classement Académie — tous les temps';

-- =============================================================================
-- SECTION 8 : ANNOUNCEMENTS
-- Annonces admin : liens WhatsApp/Telegram, tournois, maintenance
-- =============================================================================

CREATE TABLE IF NOT EXISTS announcements (
    id                  SERIAL          PRIMARY KEY,
    author_id           INTEGER         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    announcement_type   VARCHAR(20)     NOT NULL DEFAULT 'INFO'
        CHECK (announcement_type IN ('INFO','TOURNAMENT','PROMOTION','MAINTENANCE','UPDATE','WARNING')),
    title               VARCHAR(200)    NOT NULL,
    body                TEXT            NOT NULL,

    -- Canaux externes (NULL = canal non configuré)
    channel_whatsapp    VARCHAR(500)    NULL,
    channel_telegram    VARCHAR(500)    NULL,
    channel_facebook    VARCHAR(500)    NULL,
    channel_discord     VARCHAR(500)    NULL,
    channel_email       BOOLEAN         NOT NULL DEFAULT false,

    -- Affichage
    is_active           BOOLEAN         NOT NULL DEFAULT true,
    pinned              BOOLEAN         NOT NULL DEFAULT false,
    priority            SMALLINT        NOT NULL DEFAULT 0,
    target_audience     VARCHAR(20)     NOT NULL DEFAULT 'all'
        CHECK (target_audience IN ('all','players','academy','katika','superadmin')),
    expires_at          TIMESTAMPTZ     NULL,

    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  announcements IS 'Annonces admin : événements, liens WhatsApp/Telegram, maintenance, tournois';
COMMENT ON COLUMN announcements.announcement_type IS 'INFO | TOURNAMENT | PROMOTION | MAINTENANCE | UPDATE | WARNING';
COMMENT ON COLUMN announcements.priority          IS 'Ordre d''affichage : plus élevé = affiché en premier';
COMMENT ON COLUMN announcements.target_audience   IS 'all = visible par tous ; academy = joueurs académie seulement, etc.';

CREATE INDEX IF NOT EXISTS idx_ann_active   ON announcements(is_active, priority DESC) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_ann_pinned   ON announcements(pinned)                   WHERE pinned    = true;
CREATE INDEX IF NOT EXISTS idx_ann_audience ON announcements(target_audience);

CREATE TRIGGER trg_ann_updated_at
    BEFORE UPDATE ON announcements
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

COMMIT;

-- =============================================================================
-- VÉRIFICATIONS POST-MIGRATION
-- =============================================================================
-- SELECT code, symbol, country_name FROM currencies ORDER BY code;
-- SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name IN ('first_name','last_name','user_tier');
-- SELECT column_name FROM information_schema.columns WHERE table_name='salon_tables' AND column_name IN ('table_type','currency','academy_level');
-- SELECT name, table_type, academy_level, min_bet FROM salon_tables WHERE table_type='academy';
-- SELECT COUNT(*) FROM academy_wallets;
-- SELECT COUNT(*) FROM academy_transactions;
-- SELECT COUNT(*) FROM announcements;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
/*
BEGIN;
DROP VIEW  IF EXISTS v_academy_leaderboard_alltime;
DROP VIEW  IF EXISTS v_academy_leaderboard_month;
DROP VIEW  IF EXISTS v_academy_leaderboard_week;
DROP TABLE IF EXISTS academy_transactions CASCADE;
DROP TABLE IF EXISTS academy_wallets      CASCADE;
DROP TABLE IF EXISTS announcements        CASCADE;
DELETE FROM salon_tables WHERE table_type = 'academy';
ALTER TABLE salon_tables DROP COLUMN IF EXISTS table_type;
ALTER TABLE salon_tables DROP COLUMN IF EXISTS currency;
ALTER TABLE salon_tables DROP COLUMN IF EXISTS academy_level;
ALTER TABLE users        DROP COLUMN IF EXISTS first_name;
ALTER TABLE users        DROP COLUMN IF EXISTS last_name;
ALTER TABLE users        DROP COLUMN IF EXISTS user_tier;
ALTER TABLE clubs        DROP COLUMN IF EXISTS currency_code;
ALTER TABLE clubs        DROP COLUMN IF EXISTS country_code;
ALTER TABLE clubs        DROP COLUMN IF EXISTS timezone;
DROP TABLE IF EXISTS currencies CASCADE;
COMMIT;
*/
-- =============================================================================
-- FIN MIGRATION 005
-- =============================================================================
