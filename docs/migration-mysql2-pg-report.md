# Rapport de migration mysql2 → pg — FAP FAP 2026

**Date :** 2026-06-15  
**Base cible :** Neon PostgreSQL 18.4 (eu-west-2, London)  
**Auteur :** Migration automatique via Claude Code

---

## Résumé exécutif

Migration complète du backend Node.js de `mysql2` vers `pg` réalisée avec succès.  
Serveur démarré et connecté à Neon — endpoint `/api/auth/login` opérationnel.

---

## Fichiers modifiés

| Fichier | Action | Changements clés |
|---|---|---|
| `server/package.json` | Modifié | `mysql2` supprimé, `pg@8.21.0` ajouté |
| `server/.env` | Modifié | DB_HOST/DB_USER/DB_PASS/DB_NAME supprimés |
| `server/config/db.js` | Réécrit | Pool pg, ssl rejectUnauthorized:false, strip quotes |
| `server/controllers/authController.js` | Réécrit | Placeholders $N, {rows}, RETURNING id |
| `server/controllers/moneyController.js` | Réécrit | {rows}, rowCount, parseFloat(wallet) |
| `server/server.js` | Réécrit | Toutes les queries Socket.IO migrées |

---

## Variables d'environnement — avant / après

| Avant | Après |
|---|---|
| `DB_HOST=localhost` | ✗ supprimé |
| `DB_USER=root` | ✗ supprimé |
| `DB_PASS=` | ✗ supprimé |
| `DB_NAME=fap_fap_db` | ✗ supprimé |
| `PORT=5000` | `PORT=5000` ✓ |
| `JWT_SECRET=...` | `JWT_SECRET=...` ✓ |
| — | `DATABASE_URL=postgresql://...neon.tech/neondb` ✓ |

---

## Changements techniques systématiques

### 1. Driver et pool

```js
// AVANT (mysql2)
const mysql = require('mysql2/promise');
const pool = mysql.createPool({ host, user, password, database });
module.exports = pool;

// APRÈS (pg)
const { Pool } = require('pg');
const pool = new Pool({ connectionString: DATABASE_URL, ssl: {...} });
module.exports = pool;
```

### 2. Syntaxe des requêtes

```js
// AVANT
const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [id]);

// APRÈS
const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [id]);
```

### 3. Placeholders positionnels

Tous les `?` remplacés par `$1, $2, $3...` (PostgreSQL exige des placeholders numérotés).

### 4. Insertions avec retour d'ID

```js
// AVANT
const [result] = await db.query("INSERT INTO users (...) VALUES (...)");
const newId = result.insertId;

// APRÈS
const { rows } = await db.query("INSERT INTO users (...) VALUES (...) RETURNING id");
const newId = rows[0].id;
```

### 5. Comptage de lignes affectées

```js
// AVANT
result.affectedRows === 0

// APRÈS
result.rowCount === 0
```

### 6. Propriétés d'erreur

```js
// AVANT
error.sqlMessage

// APRÈS
error.detail || error.message
```

### 7. Coercition NUMERIC → string

PostgreSQL retourne les colonnes `NUMERIC`/`DECIMAL` sous forme de chaîne.  
Tous les wallets sont maintenant convertis : `parseFloat(rows[0].wallet)`.

---

## Corrections majeures apportées

### Bug original : transactions sans balance_before/balance_after

L'ancienne table MySQL n'avait pas ces colonnes. La nouvelle architecture PostgreSQL les exige (`NOT NULL`).  
**Solution :** Chaque flux transactionnel lit le solde avant l'opération, calcule le solde après, et insère les deux valeurs.

```js
// Nouveau flux (start-game — Phase 1 : lecture, Phase 2 : débit)
const balanceBefore = parseFloat(userRows[0].wallet);
const balanceAfter  = balanceBefore - table.stake;
await db.query("UPDATE users SET wallet = wallet - $1 WHERE username = $2", [stake, username]);
await db.query(
    "INSERT INTO transactions (user_id, club_id, amount, balance_before, balance_after, type) VALUES (...)",
    [username, clubId, -stake, balanceBefore, balanceAfter, 'mise']
);
```

### Bug original : transferFunds (mysql2) — mauvais ordre de paramètres

```js
// AVANT : 4 params pour 3 placeholders → 'transfert' (string) en position sender_id !
db.query("INSERT INTO transactions (user_id, amount, type, sender_id) VALUES (?, ?, 'transfert', ?)",
         [receiver_id, amount, 'transfert', sender_id])

// APRÈS : colonnes et valeurs alignées correctement
db.query("INSERT INTO transactions (user_id, sender_id, amount, balance_before, balance_after, type) VALUES ($1,$2,$3,$4,$5,'transfert')",
         [receiver_id, sender_id, amount, balanceBefore, balanceAfter])
```

---

## Architecture db.js — choix techniques

```js
const connectionString = (process.env.DATABASE_URL || '').replace(/^'|'$/g, '');
```

**Pourquoi le `.replace` :** dotenv sur Windows conserve parfois les guillemets simples si l'URL les inclut dans le fichier `.env`. Ce strip évite l'erreur de parsing.

```js
ssl: { rejectUnauthorized: false }
```

**Pourquoi :** Neon utilise un certificat TLS valide mais `sslmode=require` dans l'URL déclenche une vérification stricte du CA qui échoue dans certains environnements Node. `rejectUnauthorized: false` maintient le chiffrement tout en byppassant la vérification du certificat racine.

---

## Test de démarrage

```
[dotenv] injecting env (3) from .env
🚀 Serveur Fap Fap 2026 opérationnel sur port 5000
```

```
POST /api/auth/login → {"msg":"Identifiants incorrects."}   ← 400 attendu (user inexistant)
```

Connexion Neon : **OK**  
Routing Express : **OK**  
Socket.IO : **Chargé**

---

## Warning SSL pg (non-bloquant)

```
Warning: SECURITY WARNING: SSL modes 'prefer', 'require', 'verify-ca' are treated as aliases for 'verify-full'.
In the next major version (pg v9.0.0), these modes will adopt standard libpq semantics.
```

Ce warning concerne un changement de comportement prévu dans pg v9 (future version). Il n'affecte pas le fonctionnement actuel. Pour le supprimer maintenant, ajouter `&uselibpqcompat=true` à la DATABASE_URL.

---

## Dépendances finales

```json
{
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "cors": "^2.8.5",
    "dotenv": "^17.2.3",
    "express": "^5.1.0",
    "jsonwebtoken": "^9.0.2",
    "pg": "^8.21.0",
    "socket.io": "^4.8.1"
  }
}
```

`mysql2` : **supprimé**.

---

## Statut final

| Tâche | Statut |
|---|---|
| Installation pg | ✅ |
| Suppression mysql2 | ✅ |
| Réécriture db.js | ✅ |
| Migration authController.js | ✅ |
| Migration moneyController.js | ✅ |
| Migration server.js (Socket.IO) | ✅ |
| Nettoyage .env | ✅ |
| Test de démarrage | ✅ |
| Connexion Neon validée | ✅ |
