const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
    // On récupère le header Authorization (format standard : "Bearer <token>")
    const authHeader = req.header('Authorization');
    
    // Si pas de header du tout
    if (!authHeader) {
        return res.status(401).json({ msg: "Accès refusé, token manquant" });
    }

    // On extrait le token (on enlève le mot "Bearer " s'il est présent)
    const token = authHeader.startsWith('Bearer ') 
        ? authHeader.split(' ')[1] 
        : authHeader;

    if (!token) {
        return res.status(401).json({ msg: "Format de token invalide" });
    }

    try {
        // On vérifie le token avec la clé secrète du .env
        // JWT_SECRET vérifié au démarrage (server.js) — pas de fallback
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // On attache les infos (id, role, club_id) à l'objet req pour les contrôleurs
        req.user = decoded;
        
        next();
    } catch (e) {
        console.error("Erreur Auth Middleware:", e.message);
        res.status(401).json({ msg: "Token invalide ou expiré" });
    }
};