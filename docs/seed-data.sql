-- ============================================================
-- FAP FAP — Données initiales de test (seed)
-- Base    : neondb (Neon Cloud, eu-west-2)
-- Date    : 2026-06-16
-- IMPORTANT : À exécuter une seule fois sur base vide.
-- Mots de passe (bcrypt cost=10) :
--   Wali    → Wali2026!
--   Katika  → Katika2026!
--   Joueurs → Joueur2026!
-- ============================================================

BEGIN;

-- ============================================================
-- 1. SUPERADMIN (Wali)
-- ============================================================

INSERT INTO users (username, phone, password, role, wallet, status)
VALUES (
    'Wali_FAP',
    '0600000001',
    '$2b$10$uD2jZYMwWSOZP9DIyn7O9uHXA41TITGe4Rnzn7W0Z1ORGTXYLuq8O',
    'superadmin',
    1000000.00,
    'active'
);

-- ============================================================
-- 2. KATIKA (gestionnaire de club)
--    club_id mis à jour après la création du club (étape 4)
-- ============================================================

INSERT INTO users (username, phone, password, role, wallet, status)
VALUES (
    'Katika_Issa',
    '0600000002',
    '$2b$10$4jRHLhVda26NC4onz6b5QudpI3clsAsRP6AMEa2Iy//7diNcq.Dom',
    'katika',
    50000.00,
    'active'
);

-- ============================================================
-- 3. CLUB — lié au Katika
-- ============================================================

INSERT INTO clubs (name, katika_id, stake_default, max_players, commission_rate, status)
VALUES (
    'Club Alpha',
    (SELECT id FROM users WHERE phone = '0600000002'),
    500.00,
    4,
    0.0500,
    'open'
);

-- ============================================================
-- 4. Liaison Katika ↔ Club
-- ============================================================

UPDATE users
SET club_id = (SELECT id FROM clubs WHERE name = 'Club Alpha')
WHERE phone = '0600000002';

-- ============================================================
-- 5. JOUEURS (4 joueurs du Club Alpha)
-- ============================================================

INSERT INTO users (username, phone, password, role, wallet, club_id, status)
VALUES
(
    'Joueur_Moussa',
    '0600000003',
    '$2b$10$ZJuF18zdjHcDuvHWjxvLhOBL8cOX7cBTWAoA9vgmKuKuY72zIhVaq',
    'player',
    0.00,
    (SELECT id FROM clubs WHERE name = 'Club Alpha'),
    'active'
),
(
    'Joueur_Fatou',
    '0600000004',
    '$2b$10$ZJuF18zdjHcDuvHWjxvLhOBL8cOX7cBTWAoA9vgmKuKuY72zIhVaq',
    'player',
    0.00,
    (SELECT id FROM clubs WHERE name = 'Club Alpha'),
    'active'
),
(
    'Joueur_Kofi',
    '0600000005',
    '$2b$10$ZJuF18zdjHcDuvHWjxvLhOBL8cOX7cBTWAoA9vgmKuKuY72zIhVaq',
    'player',
    0.00,
    (SELECT id FROM clubs WHERE name = 'Club Alpha'),
    'active'
),
(
    'Joueur_Awa',
    '0600000006',
    '$2b$10$ZJuF18zdjHcDuvHWjxvLhOBL8cOX7cBTWAoA9vgmKuKuY72zIhVaq',
    'player',
    0.00,
    (SELECT id FROM clubs WHERE name = 'Club Alpha'),
    'active'
);

-- ============================================================
-- 6. RECHARGES INITIALES (Wali → Joueurs)
--    Wali est superadmin : son wallet ne diminue pas (logique app)
-- ============================================================

-- Recharge Moussa : 10 000 FCFA
UPDATE users SET wallet = 10000.00 WHERE phone = '0600000003';
INSERT INTO transactions (user_id, sender_id, amount, balance_before, balance_after, type, note)
VALUES (
    (SELECT id FROM users WHERE phone = '0600000003'),
    (SELECT id FROM users WHERE phone = '0600000001'),
    10000.00, 0.00, 10000.00, 'recharge', 'Dotation initiale Wali → Moussa'
);

-- Recharge Fatou : 8 000 FCFA
UPDATE users SET wallet = 8000.00 WHERE phone = '0600000004';
INSERT INTO transactions (user_id, sender_id, amount, balance_before, balance_after, type, note)
VALUES (
    (SELECT id FROM users WHERE phone = '0600000004'),
    (SELECT id FROM users WHERE phone = '0600000001'),
    8000.00, 0.00, 8000.00, 'recharge', 'Dotation initiale Wali → Fatou'
);

-- Recharge Kofi : 5 000 FCFA
UPDATE users SET wallet = 5000.00 WHERE phone = '0600000005';
INSERT INTO transactions (user_id, sender_id, amount, balance_before, balance_after, type, note)
VALUES (
    (SELECT id FROM users WHERE phone = '0600000005'),
    (SELECT id FROM users WHERE phone = '0600000001'),
    5000.00, 0.00, 5000.00, 'recharge', 'Dotation initiale Wali → Kofi'
);

-- Recharge Awa : 3 000 FCFA
UPDATE users SET wallet = 3000.00 WHERE phone = '0600000006';
INSERT INTO transactions (user_id, sender_id, amount, balance_before, balance_after, type, note)
VALUES (
    (SELECT id FROM users WHERE phone = '0600000006'),
    (SELECT id FROM users WHERE phone = '0600000001'),
    3000.00, 0.00, 3000.00, 'recharge', 'Dotation initiale Wali → Awa'
);

-- ============================================================
-- 7. PARTIE DE DÉMONSTRATION
--    Mise : 500 FCFA × 4 joueurs = pot 2 000 FCFA
--    Gagnant : Joueur_Moussa (victoire normale)
-- ============================================================

-- Session de jeu
INSERT INTO game_sessions (club_id, dealer_id, stake, pot_total, nb_players, status, win_type, started_at, finished_at)
VALUES (
    (SELECT id FROM clubs WHERE name = 'Club Alpha'),
    (SELECT id FROM users WHERE phone = '0600000003'),  -- Moussa est dealer
    500.00,
    2000.00,
    4,
    'finished',
    'normal',
    NOW() - INTERVAL '30 minutes',
    NOW() - INTERVAL '10 minutes'
);

-- Résultats des joueurs dans la partie
INSERT INTO game_players (game_session_id, user_id, stake_paid, gain_received, result)
VALUES
(
    (SELECT id FROM game_sessions ORDER BY id DESC LIMIT 1),
    (SELECT id FROM users WHERE phone = '0600000003'),  -- Moussa
    500.00, 2000.00, 'winner'
),
(
    (SELECT id FROM game_sessions ORDER BY id DESC LIMIT 1),
    (SELECT id FROM users WHERE phone = '0600000004'),  -- Fatou
    500.00, 0.00, 'loser'
),
(
    (SELECT id FROM game_sessions ORDER BY id DESC LIMIT 1),
    (SELECT id FROM users WHERE phone = '0600000005'),  -- Kofi
    500.00, 0.00, 'loser'
),
(
    (SELECT id FROM game_sessions ORDER BY id DESC LIMIT 1),
    (SELECT id FROM users WHERE phone = '0600000006'),  -- Awa
    500.00, 0.00, 'loser'
);

-- Mises (débit 500 FCFA par joueur)
UPDATE users SET wallet = wallet - 500.00 WHERE phone = '0600000003';  -- Moussa: 10000→9500
INSERT INTO transactions (user_id, club_id, amount, balance_before, balance_after, type, note)
VALUES (
    (SELECT id FROM users WHERE phone='0600000003'),
    (SELECT id FROM clubs WHERE name='Club Alpha'),
    -500.00, 10000.00, 9500.00, 'mise', 'Partie démo — mise Moussa'
);

UPDATE users SET wallet = wallet - 500.00 WHERE phone = '0600000004';  -- Fatou: 8000→7500
INSERT INTO transactions (user_id, club_id, amount, balance_before, balance_after, type, note)
VALUES (
    (SELECT id FROM users WHERE phone='0600000004'),
    (SELECT id FROM clubs WHERE name='Club Alpha'),
    -500.00, 8000.00, 7500.00, 'mise', 'Partie démo — mise Fatou'
);

UPDATE users SET wallet = wallet - 500.00 WHERE phone = '0600000005';  -- Kofi: 5000→4500
INSERT INTO transactions (user_id, club_id, amount, balance_before, balance_after, type, note)
VALUES (
    (SELECT id FROM users WHERE phone='0600000005'),
    (SELECT id FROM clubs WHERE name='Club Alpha'),
    -500.00, 5000.00, 4500.00, 'mise', 'Partie démo — mise Kofi'
);

UPDATE users SET wallet = wallet - 500.00 WHERE phone = '0600000006';  -- Awa: 3000→2500
INSERT INTO transactions (user_id, club_id, amount, balance_before, balance_after, type, note)
VALUES (
    (SELECT id FROM users WHERE phone='0600000006'),
    (SELECT id FROM clubs WHERE name='Club Alpha'),
    -500.00, 3000.00, 2500.00, 'mise', 'Partie démo — mise Awa'
);

-- Gain (crédit pot 2000 FCFA → Moussa : 9500→11500)
UPDATE users SET wallet = wallet + 2000.00 WHERE phone = '0600000003';
INSERT INTO transactions (user_id, club_id, amount, balance_before, balance_after, type, note)
VALUES (
    (SELECT id FROM users WHERE phone='0600000003'),
    (SELECT id FROM clubs WHERE name='Club Alpha'),
    2000.00, 9500.00, 11500.00, 'gain', 'Partie démo — victoire Moussa (normale)'
);

-- ============================================================
-- 8. TRANSFERT DE DÉMONSTRATION (Katika_Issa → Joueur_Moussa)
--    Katika : 50000→45000 / Moussa : 11500→16500
-- ============================================================

UPDATE users SET wallet = wallet - 5000.00 WHERE phone = '0600000002';  -- Katika
UPDATE users SET wallet = wallet + 5000.00 WHERE phone = '0600000003';  -- Moussa

-- Transaction côté receveur
INSERT INTO transactions (user_id, sender_id, club_id, amount, balance_before, balance_after, type, note)
VALUES (
    (SELECT id FROM users WHERE phone='0600000003'),  -- Moussa
    (SELECT id FROM users WHERE phone='0600000002'),  -- Katika expéditeur
    (SELECT id FROM clubs WHERE name='Club Alpha'),
    5000.00, 11500.00, 16500.00, 'transfert', 'Transfert démo Katika→Moussa'
);

-- ============================================================
-- 9. DEMANDE DE RECHARGE DE DÉMONSTRATION
-- ============================================================

INSERT INTO recharge_requests (requester_id, target_id, amount, status, note)
VALUES (
    (SELECT id FROM users WHERE phone='0600000004'),  -- Fatou demande
    (SELECT id FROM users WHERE phone='0600000004'),  -- pour elle-même
    5000.00,
    'pending',
    'Demande de recharge 5000 FCFA — en attente Wali'
);

COMMIT;

-- ============================================================
-- VÉRIFICATION POST-SEED (lecture seule)
-- ============================================================

SELECT
    u.username,
    u.phone,
    u.role::text,
    u.wallet,
    c.name AS club
FROM users u
LEFT JOIN clubs c ON u.club_id = c.id
ORDER BY u.id;
