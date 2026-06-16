const db = require('./config/db');
const bcrypt = require('bcryptjs');

async function reset() {
    try {
        const pass = "Jolies";
        // On génère le hash avec la librairie installée
        const hash = await bcrypt.hash(pass, 10);
        
        // Mise à jour de Wali Sylver
        const [res] = await db.query(
            "UPDATE users SET password = ?, role = 'superadmin' WHERE phone = '0700000001'", 
            [hash]
        );

        if (res.affectedRows === 0) {
            // Si Wali n'existe pas encore, on le crée
            await db.query(
                "INSERT INTO users (username, phone, password, role, wallet, club_id) VALUES (?, ?, ?, ?, ?, ?)",
                ['Wali Sylver', '0700000001', hash, 'superadmin', 1000000, 1]
            );
            console.log("✅ Wali Sylver créé avec succès !");
        } else {
            console.log("✅ Mot de passe de Wali mis à jour avec le bon Hash !");
        }
        
        process.exit();
    } catch (err) {
        console.error("❌ Erreur SQL :", err);
        process.exit(1);
    }
}

reset();