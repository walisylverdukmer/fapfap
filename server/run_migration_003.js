require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const sql = fs.readFileSync(
    path.join(__dirname, 'migrations', '003_sprint6.sql'),
    'utf8'
);

pool.query(sql)
    .then(() => {
        console.log('Migration 003 exécutée avec succès.');
        pool.end();
    })
    .catch(err => {
        console.error('ERREUR migration 003 :', err.message);
        pool.end();
        process.exit(1);
    });
