-- =============================================================================
-- FAP FAP 2.2 — Migration 006 : CGU versionnées + Retraits Wave + Settings
-- Date       : 2026-06-26
-- Dépend de  : 001-005 déjà exécutées
-- Exécuter   : node server/run_migration_006.js
-- =============================================================================

BEGIN;

-- =============================================================================
-- SECTION 1 : ÉTENDRE L'ENUM notification_type
-- =============================================================================

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'demande_retrait';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'retrait_valide';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'retrait_refuse';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'retrait_paye';

-- =============================================================================
-- SECTION 2 : TERMS_ACCEPTANCES — Historique des acceptations CGU
-- =============================================================================

CREATE TABLE IF NOT EXISTS terms_acceptances (
    id          SERIAL          PRIMARY KEY,
    user_id     INTEGER         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version     VARCHAR(10)     NOT NULL DEFAULT '1.0',
    accepted_at TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    ip_address  INET            NULL,
    CONSTRAINT uq_terms_user_version UNIQUE (user_id, version)
);

CREATE INDEX IF NOT EXISTS idx_ta_user    ON terms_acceptances(user_id);
CREATE INDEX IF NOT EXISTS idx_ta_version ON terms_acceptances(version);

COMMENT ON TABLE  terms_acceptances IS 'Historique des acceptations CGU par utilisateur et par version';
COMMENT ON COLUMN terms_acceptances.version IS 'Version des CGU acceptées — incrémentée par platform_settings.terms_version';

-- =============================================================================
-- SECTION 3 : WITHDRAWAL_REQUESTS — Demandes de retrait Wave
-- =============================================================================

CREATE TYPE withdrawal_status AS ENUM ('pending', 'validated', 'rejected', 'paid');

CREATE TABLE IF NOT EXISTS withdrawal_requests (
    id              SERIAL              PRIMARY KEY,
    user_id         INTEGER             NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount          NUMERIC(15,2)       NOT NULL CHECK (amount > 0),
    wave_number     VARCHAR(30)         NOT NULL,
    wave_holder     VARCHAR(100)        NOT NULL,
    observations    TEXT                NULL,
    status          withdrawal_status   NOT NULL DEFAULT 'pending',
    reviewed_by     INTEGER             NULL REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ         NULL,
    paid_at         TIMESTAMPTZ         NULL,
    review_note     TEXT                NULL,
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wr_user_id ON withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_wr_status  ON withdrawal_requests(status) WHERE status IN ('pending', 'validated');
CREATE INDEX IF NOT EXISTS idx_wr_created ON withdrawal_requests(created_at DESC);

COMMENT ON TABLE  withdrawal_requests IS 'Demandes de retrait Wave — statuts: pending → validated → paid | rejected';
COMMENT ON COLUMN withdrawal_requests.wave_number IS 'Numéro Wave du bénéficiaire';
COMMENT ON COLUMN withdrawal_requests.wave_holder IS 'Nom du titulaire du compte Wave';
COMMENT ON COLUMN withdrawal_requests.paid_at     IS 'Horodatage du paiement effectif — NULL tant que non payé';

-- =============================================================================
-- SECTION 4 : PLATFORM_SETTINGS — Paramètres administrables
-- =============================================================================

CREATE TABLE IF NOT EXISTS platform_settings (
    key         VARCHAR(50)     PRIMARY KEY,
    value       TEXT            NOT NULL DEFAULT '',
    updated_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_by  INTEGER         NULL REFERENCES users(id)
);

COMMENT ON TABLE platform_settings IS 'Paramètres administrables via dashboard Wali : liens WhatsApp, versions CGU, etc.';

-- Valeurs initiales (idempotent)
INSERT INTO platform_settings (key, value) VALUES
    ('whatsapp_link',   ''),
    ('terms_version',   '1.0'),
    ('app_name',        'FAP FAP')
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- =============================================================================
-- VÉRIFICATIONS POST-MIGRATION
-- =============================================================================
-- SELECT * FROM platform_settings;
-- \d withdrawal_requests
-- \d terms_acceptances
-- SELECT enum_range(NULL::notification_type);

-- =============================================================================
-- ROLLBACK
-- =============================================================================
/*
BEGIN;
DROP TABLE IF EXISTS withdrawal_requests CASCADE;
DROP TABLE IF EXISTS terms_acceptances   CASCADE;
DROP TABLE IF EXISTS platform_settings   CASCADE;
DROP TYPE  IF EXISTS withdrawal_status;
COMMIT;
*/
-- =============================================================================
-- FIN MIGRATION 006
-- =============================================================================
