const { Pool } = require('pg');

// DATABASE_URL peut être entourée de quotes simples dans le .env — on les retire
const connectionString = (process.env.DATABASE_URL || '').replace(/^'|'$/g, '');

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
    console.error('Erreur inattendue sur le pool PostgreSQL:', err.message);
});

module.exports = pool;
