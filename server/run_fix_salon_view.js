require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// CREATE OR REPLACE VIEW impose que les nouvelles colonnes soient en fin de liste.
// Les colonnes existantes (table_id..observers) restent dans le même ordre.
const sql = `
CREATE OR REPLACE VIEW v_salon_state AS
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
    )                                                                   AS observers,
    -- Nouvelles colonnes FAP FAP 2.1 (ajoutées en fin pour respecter CREATE OR REPLACE)
    st.table_type,
    st.currency,
    st.academy_level
FROM salon_tables st
LEFT JOIN clubs c             ON st.club_id    = c.id
LEFT JOIN table_seats ts      ON st.id         = ts.table_id
LEFT JOIN users us             ON ts.user_id   = us.id
LEFT JOIN table_observers to2  ON st.id        = to2.table_id
LEFT JOIN users uo             ON to2.user_id  = uo.id
WHERE st.status <> 'closed'
GROUP BY st.id, st.name, st.status, st.min_bet, st.max_players,
         st.invite_token, st.table_type, st.currency, st.academy_level, c.name
ORDER BY st.id;
`;

pool.query(sql)
    .then(async () => {
        console.log('Vue v_salon_state mise à jour — table_type, currency, academy_level inclus.');

        // Vérification immédiate
        const { rows } = await pool.query(
            `SELECT table_id, table_name, table_type, currency, academy_level
             FROM v_salon_state ORDER BY table_id`
        );
        console.log('\nTables visibles dans le salon (' + rows.length + ') :');
        rows.forEach(r => console.log(
            '  #' + r.table_id + ' ' + r.table_name +
            ' [' + r.table_type + '/' + r.currency + ']' +
            (r.academy_level ? ' level=' + r.academy_level : '')
        ));
        pool.end();
    })
    .catch(err => {
        console.error('ERREUR :', err.message);
        pool.end();
        process.exit(1);
    });
