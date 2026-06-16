# 05 — Problèmes de Sécurité

> Date : 2026-06-15  
> Référentiel : OWASP Top 10 2021

---

## Résumé des risques

| Sévérité | Nombre |
|----------|--------|
| 🔴 CRITIQUE | 3 |
| 🟠 ÉLEVÉ | 3 |
| 🟡 MOYEN | 4 |
| 🔵 FAIBLE | 2 |

---

## 🔴 CRITIQUE

### SEC-01 : Auto-déclaration de victoire (Exploit jeu)

**Localisation** : `server/server.js:383-390`

**Description** : N'importe quel joueur actif peut envoyer `claim-special-victory` depuis son navigateur (DevTools console) avec n'importe quel type, et le serveur lui crédite le pot sans aucune validation.

```javascript
// EXPLOIT : dans la console du navigateur
socket.emit('claim-special-victory', {
    club_id: 1,
    type: 'KORATTE',   // pot × 2 sans vérification
    reason: 'Triche'
});
// → Le joueur reçoit pot * 2 immédiatement
```

**Impact** : Toute la trésorerie d'une table peut être volée en un clic.

**Correction** :
```javascript
socket.on('claim-special-victory', (data) => {
    const player = table?.players.find(p => p.id === socket.id);
    if (!player?.isInHand) return;
    
    // Valider la main côté serveur avant d'accorder la victoire
    const isValid = validateSpecialVictory(data.type, player.hand);
    if (!isValid) {
        socket.emit('cheat-detected', { message: 'Main invalide pour cette victoire' });
        return;
    }
    // ...
});
```

---

### SEC-02 : JWT Secret faible exposé dans le code

**Localisation** : `server/.env:5` + `server/init_db.js` (commentaires)

```
JWT_SECRET=ton_secret_ultra_securise_2026
```

**Problèmes** :
1. Le secret est prévisible (français, année courante)
2. Le fichier `.env` n'est pas dans `.gitignore` (risque de commit accidentel)
3. Les mots de passe de seeding (`Jolies`, `123456`) sont visibles dans le code

**Impact** : Un attaquant peut forger un JWT valide avec `role: superadmin` et accéder à toutes les fonctions admin.

```javascript
// Forge d'un token admin
const jwt = require('jsonwebtoken');
const fakeToken = jwt.sign(
    { id: 1, role: 'superadmin', club_id: null },
    'ton_secret_ultra_securise_2026',  // trouvé sur GitHub
    { expiresIn: '30d' }
);
// → Accès total à /api/money/transfer, /api/money/all-katikas, etc.
```

**Correction** :
```bash
# Générer un secret cryptographiquement sûr (32 bytes)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

### SEC-03 : Pas de vérification d'autorisation sur les transferts

**Localisation** : `server/controllers/moneyController.js` — `transferFunds()`

**Description** : La seule vérification est `if sender is NOT superadmin, check balance`. Cela signifie :
- Un Katika peut transférer vers n'importe quel utilisateur (pas seulement ses joueurs)
- Un Player peut potentiellement appeler `/api/money/transfer` (si token non expiré)
- Aucune vérification que `receiver_id` appartient au club de l'émetteur

```javascript
// Un player peut appeler :
fetch('/api/money/transfer', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${localStorage.token}` },
    body: JSON.stringify({ receiver_id: <autre_user_id>, amount: 1 })
})
// Si son wallet > 0, le transfert est effectué sans restriction de rôle
```

**Correction** :
```javascript
// Règles à appliquer :
// - superadmin → peut transférer vers n'importe qui
// - katika → peut transférer uniquement vers ses propres joueurs (même club_id)
// - player → ne peut PAS effectuer de transfert P2P
if (req.user.role === 'player') return res.status(403).json({ error: 'Non autorisé' });
if (req.user.role === 'katika') {
    const [receiver] = await db.query(
        'SELECT club_id FROM users WHERE id = ?', [receiver_id]
    );
    if (receiver[0]?.club_id !== req.user.club_id) {
        return res.status(403).json({ error: 'Joueur hors de votre club' });
    }
}
```

---

## 🟠 ÉLEVÉ

### SEC-04 : Pas de rate limiting (Brute force)

**Localisation** : `server/routes/authRoutes.js` — `POST /api/auth/login`

**Description** : Aucune limitation du nombre de tentatives de connexion. Un attaquant peut tester des milliers de mots de passe sur un numéro de téléphone connu.

**Correction** :
```bash
npm install express-rate-limit
```
```javascript
const rateLimit = require('express-rate-limit');
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 5,                      // 5 tentatives
    message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' }
});
router.post('/login', loginLimiter, authController.login);
```

---

### SEC-05 : CORS wildcard en production

**Localisation** : `server/server.js:15-18`

```javascript
app.use(cors({ origin: "*" }));
```

**Description** : En production, tout domaine peut effectuer des requêtes authentifiées vers l'API, y compris des sites malveillants. Si un token JWT est stocké dans un cookie (et non localStorage), cela ouvre une vulnérabilité CSRF.

**Note** : Actuellement le token est en localStorage (pas de CSRF via cookie), mais le wildcard CORS reste une mauvaise pratique.

**Correction** :
```javascript
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) callback(null, true);
        else callback(new Error('Origine non autorisée'));
    }
}));
```

---

### SEC-06 : Injection SQL potentielle (requêtes non paramétrées partielles)

**Localisation** : `server/server.js:157` — Subquery dans INSERT

```javascript
const sqlTransaction = "INSERT INTO transactions (user_id, club_id, amount, type) " +
    "VALUES ((SELECT id FROM users WHERE username = ?), ?, ?, 'mise')";
```

**Description** : Le paramètre `?` est correctement utilisé ici, mais la sous-requête imbriquée est un anti-pattern. Si le driver échoue à la paramétrer correctement, ou si un futur développeur la modifie, cela devient vulnérable.

**Correction** : Utiliser `socket.userId` (déjà disponible sur la socket) au lieu de la sous-requête :
```javascript
await db.query(
    "INSERT INTO transactions (user_id, club_id, amount, type) VALUES (?, ?, ?, 'mise')",
    [p.userId, data.club_id, -table.stake]
);
```

---

## 🟡 MOYEN

### SEC-07 : Pas de validation des entrées utilisateur

**Localisation** : `server/controllers/authController.js`

**Description** : Les champs `username`, `phone`, `password`, `clubName` ne sont pas validés :
- Pas de longueur minimale/maximale
- Pas de format de téléphone
- Pas de force de mot de passe
- Un username de 1000 caractères est accepté

**Correction** :
```bash
npm install joi
```
```javascript
const schema = Joi.object({
    username: Joi.string().min(2).max(50).required(),
    phone: Joi.string().pattern(/^0[0-9]{9}$/).required(),
    password: Joi.string().min(8).max(128).required(),
    clubName: Joi.string().min(2).max(100).required()
});
```

---

### SEC-08 : Tokens JWT non révocables

**Description** : Les JWT expiren dans 24h mais ne peuvent pas être révoqués avant. Si un compte Katika est compromis, le token reste valide 24h même après changement de mot de passe.

**Correction** : Implémenter une liste noire de tokens (Redis) ou utiliser des refresh tokens à courte durée.

---

### SEC-09 : Mots de passe en clair dans le code source

**Localisation** : `server/init_db.js`, `server/seed.js`, `server/reset_wali.js`

```javascript
const hash = await bcrypt.hash('Jolies', salt);  // init_db.js
const hash = await bcrypt.hash('123456', salt);  // seed.js
```

**Description** : Les mots de passe de production (Wali Sylver = `Jolies`) sont commités en clair dans le code source. Si le repo est public ou partagé, c'est une fuite directe.

**Correction** : Utiliser des variables d'environnement.
```javascript
const hash = await bcrypt.hash(process.env.WALI_INITIAL_PASSWORD, salt);
```

---

### SEC-10 : Absence de HTTPS

**Description** : Le serveur écoute sur HTTP (port 5000) sans TLS. Les tokens JWT et mots de passe transitent en clair sur le réseau.

**Correction** : Mettre un reverse proxy NGINX ou Caddy devant avec TLS, ou utiliser `https` natif Node.js avec un certificat Let's Encrypt.

---

## 🔵 FAIBLE

### SEC-11 : localStorage pour les tokens JWT

**Description** : Les tokens JWT sont stockés en `localStorage`, accessibles par tout JavaScript de la page (XSS). Un site malveillant injecté via XSS peut voler le token.

**Correction** : Utiliser des cookies `HttpOnly; Secure; SameSite=Strict`.

---

### SEC-12 : Pas de Content Security Policy (CSP)

**Description** : Aucun header CSP n'est défini, rendant le site vulnérable aux injections de scripts tiers (XSS via ressources externes comme DiceBear API).

**Correction** :
```javascript
app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; img-src 'self' https://api.dicebear.com; script-src 'self'");
    next();
});
```

---

## Plan de correction prioritaire

| Priorité | ID | Action | Effort |
|----------|----|--------|--------|
| 🔴 P0 | SEC-01 | Valider les victoires spéciales côté serveur | 2h |
| 🔴 P0 | SEC-02 | Changer le JWT secret + gitignore .env | 30min |
| 🔴 P0 | SEC-03 | Ajouter vérification de rôle sur les transferts | 1h |
| 🟠 P1 | SEC-04 | Ajouter rate limiting sur login | 30min |
| 🟠 P1 | SEC-07 | Validation des entrées (Joi) | 3h |
| 🟠 P1 | SEC-06 | Remplacer sous-requêtes par IDs directs | 1h |
| 🟡 P2 | SEC-05 | CORS restrictif | 30min |
| 🟡 P2 | SEC-09 | Passwords via variables d'env | 30min |
| 🔵 P3 | SEC-10 | HTTPS via reverse proxy | 2h |
| 🔵 P3 | SEC-11 | Migrer vers cookies HttpOnly | 4h |
