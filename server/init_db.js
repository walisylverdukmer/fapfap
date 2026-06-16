const db = require('./config/db');
const bcrypt = require('bcryptjs');

async function createWali() {
    try {
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash('Jolies', salt);
        
        // On nettoie l'ancien Wali pour éviter les doublons
        await db.query("DELETE FROM users WHERE phone = '0700000001'");
        
        // On insère le Wali "officiel" avec le hash généré par ton propre environnement
        const sql = `INSERT INTO users (username, phone, password, role, wallet, club_id) 
                     VALUES ('Wali Sylver', '0700000001', ?, 'superadmin', 1000000, 1)`;
        
        await db.query(sql, [hash]);
        
        console.log("------------------------------------------");
        console.log("✅ WALI SYLVER CRÉÉ AVEC SUCCÈS !");
        console.log("Login: 0700000001");
        console.log("Pass: Jolies");
        console.log("------------------------------------------");
        process.exit();
    } catch (err) {
        console.error("❌ Erreur :", err);
        process.exit(1);
    }
}

createWali();