const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function seed() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'root', // Ton utilisateur MySQL
        password: '',     // Ton mot de passe MySQL
        database: 'fap_fap_db'
    });

    const hash = await bcrypt.hash('123456', 10);

    const users = [
        ['Boss Admin', '0700000000', hash, 'superadmin', 1000000],
        ['Jean Katika', '0701010101', hash, 'katika', 500000],
        ['Paul Joueur', '0702020202', hash, 'player', 50000]
    ];

    console.log("🌱 Insertion des utilisateurs...");

    for (const u of users) {
        try {
            await connection.execute(
                `INSERT INTO users (username, phone, password, role, wallet) VALUES (?, ?, ?, ?, ?)`,
                u
            );
            console.log(`✅ Créé : ${u[0]}`);
        } catch (err) {
            console.log(`❌ Erreur pour ${u[0]} :`, err.message);
        }
    }
    
    await connection.end();
    console.log("🚀 Terminé !");
    process.exit();
}

seed();