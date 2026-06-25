-- =============================================================================
-- FAP FAP 2.0 — Migration 004 : Notifications temps réel
-- Date       : 2026-06-17
-- Dépend de  : 001_neon_schema.sql (users, clubs, fn_set_updated_at)
-- Réversible : voir SECTION ROLLBACK en bas de fichier
-- =============================================================================
-- Exécuter depuis Neon Console → SQL Editor, ou :
--   psql $DATABASE_URL -f server/migrations/004_notifications.sql
-- =============================================================================

BEGIN;

-- =============================================================================
-- SECTION 1 : TYPES ÉNUMÉRÉS
-- =============================================================================

CREATE TYPE notification_type AS ENUM (
    'nouvelle_inscription',
    'demande_jetons',
    'recharge_validee',
    'recharge_rejetee',
    'suspension',
    'creation_table',
    'fermeture_table'
);

CREATE TYPE notification_audience AS ENUM (
    'wali',
    'katika',
    'all_admin',
    'player'
);

-- =============================================================================
-- SECTION 2 : TABLE notifications
-- =============================================================================

CREATE TABLE notifications (
    id          SERIAL                  PRIMARY KEY,
    type        notification_type       NOT NULL,
    audience    notification_audience   NOT NULL DEFAULT 'all_admin',
    title       VARCHAR(120)            NOT NULL,
    body        TEXT,
    club_id     INTEGER                 REFERENCES clubs(id)  ON DELETE SET NULL,
    actor_id    INTEGER                 REFERENCES users(id)  ON DELETE SET NULL,
    subject_id  INTEGER                 REFERENCES users(id)  ON DELETE SET NULL,
    metadata    JSONB                   NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ             NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  notifications IS 'Fil de notifications admin/katika/joueur — jamais supprimées';
COMMENT ON COLUMN notifications.actor_id   IS 'Qui a déclenché l action (joueur inscrit, admin qui valide…)';
COMMENT ON COLUMN notifications.subject_id IS 'Sur qui porte la notification (peut être égal à actor_id)';
COMMENT ON COLUMN notifications.club_id    IS 'NULL = tous clubs ; non NULL = club concerné';

-- =============================================================================
-- SECTION 3 : TABLE notification_reads (pivot many-to-many)
-- =============================================================================

CREATE TABLE notification_reads (
    notification_id INTEGER     NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_id         INTEGER     NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
    read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (notification_id, user_id)
);

COMMENT ON TABLE notification_reads IS 'Suivi lecture : une ligne par (notification, utilisateur admin)';

-- =============================================================================
-- SECTION 4 : INDEX
-- =============================================================================

CREATE INDEX idx_notif_audience    ON notifications(audience, created_at DESC);
CREATE INDEX idx_notif_club        ON notifications(club_id)    WHERE club_id   IS NOT NULL;
CREATE INDEX idx_notif_subject     ON notifications(subject_id) WHERE subject_id IS NOT NULL;
CREATE INDEX idx_notif_type        ON notifications(type);
CREATE INDEX idx_notif_reads_user  ON notification_reads(user_id);

-- =============================================================================
-- SECTION 5 : VUE — notifications non lues
-- La condition sur user_id est injectée côté applicatif
-- =============================================================================

CREATE VIEW v_notifications_unread AS
SELECT
    n.id,
    n.type,
    n.audience,
    n.title,
    n.body,
    n.club_id,
    n.actor_id,
    n.subject_id,
    n.metadata,
    n.created_at,
    u_actor.username   AS actor_username,
    u_subject.username AS subject_username
FROM notifications n
LEFT JOIN users u_actor   ON n.actor_id   = u_actor.id
LEFT JOIN users u_subject ON n.subject_id = u_subject.id
ORDER BY n.created_at DESC;

COMMENT ON VIEW v_notifications_unread IS
    'Toutes les notifications avec usernames résolus — filtrage is_read fait en applicatif';

COMMIT;

-- =============================================================================
-- VÉRIFICATIONS POST-MIGRATION
-- =============================================================================
-- SELECT COUNT(*) FROM notifications;
-- SELECT COUNT(*) FROM notification_reads;
-- SELECT * FROM v_notifications_unread LIMIT 5;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
/*
BEGIN;
DROP VIEW  IF EXISTS v_notifications_unread;
DROP TABLE IF EXISTS notification_reads CASCADE;
DROP TABLE IF EXISTS notifications      CASCADE;
DROP TYPE  IF EXISTS notification_type;
DROP TYPE  IF EXISTS notification_audience;
COMMIT;
*/

-- =============================================================================
-- FIN MIGRATION 004
-- =============================================================================
