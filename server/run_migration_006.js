require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const sql = fs.readFileSync(
    path.join(__dirname, 'migrations', '006_fap22.sql'),
    'utf8'
);

pool.query(sql)
    .then(() => {
        console.log('Migration 006 exécutée avec succès.');
        pool.end();
    })
    .catch(err => {
        console.error('ERREUR migration 006 :', err.message);
        pool.end();
        process.exit(1);
    });
