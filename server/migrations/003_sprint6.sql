-- =============================================================================
-- FAP FAP 2.0 — Migration 003 : Sprint 6
-- Date       : 2026-06-17
-- Dépend de  : 001_neon_schema.sql, 002_salon.sql
-- Réversible : voir SECTION ROLLBACK en bas de fichier
-- =============================================================================
-- Exécuter depuis Neon Console → SQL Editor, ou :
--   psql $DATABASE_URL -f server/migrations/003_sprint6.sql
-- =============================================================================

BEGIN;

-- =============================================================================
-- SECTION 1 : COLONNES SUPPLÉMENTAIRES
-- =============================================================================

-- users.last_seen_at — présence temps réel (mis à jour par ping Socket.IO)
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NULL;

-- salon_tables.pin_message — message épinglé par l'admin sur une table
ALTER TABLE salon_tables
    ADD COLUMN IF NOT EXISTS pin_message VARCHAR(200) NULL;

-- =============================================================================
-- SECTION 2 : INDEX
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_users_last_seen
    ON users(last_seen_at DESC NULLS LAST);

-- =============================================================================
-- SECTION 3 : CLUB PUBLIC
-- Club rattachement des joueurs qui s'inscrivent via /play
-- Géré par le Wali (premier superadmin)
-- =============================================================================

INSERT INTO clubs (name, katika_id)
SELECT 'Public', id
FROM   users
WHERE  role = 'superadmin'
  AND  NOT EXISTS (SELECT 1 FROM clubs WHERE name = 'Public')
ORDER  BY id
LIMIT  1;

COMMIT;

-- =============================================================================
-- VÉRIFICATIONS POST-MIGRATION
-- =============================================================================
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'users' AND column_name = 'last_seen_at';

-- SELECT id, name, katika_id FROM clubs WHERE name = 'Public';

-- =============================================================================
-- ROLLBACK
-- =============================================================================
/*
BEGIN;
ALTER TABLE users        DROP COLUMN IF EXISTS last_seen_at;
ALTER TABLE salon_tables DROP COLUMN IF EXISTS pin_message;
DROP INDEX  IF EXISTS idx_users_last_seen;
DELETE FROM clubs WHERE name = 'Public';
COMMIT;
*/
-- =============================================================================
-- FIN MIGRATION 003
-- =============================================================================
