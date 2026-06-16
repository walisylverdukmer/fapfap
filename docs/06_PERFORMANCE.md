# 06 — Problèmes de Performance

> Date : 2026-06-15

---

## Résumé

| Catégorie | Problème | Impact |
|-----------|---------|--------|
| Requêtes SQL | N+1 queries au démarrage de partie | 🔴 Critique |
| Requêtes SQL | Recherche par `username` au lieu d'`id` | 🟠 Élevé |
| Mémoire | État de jeu en RAM sans persistence | 🟠 Élevé |
| Requêtes SQL | Pas d'index sur les colonnes fréquentes | 🟡 Moyen |
| Réseau | Pas de compression des émissions Socket.IO | 🟡 Moyen |
| CPU | `Math.random()` pour mélanger le deck | 🔵 Faible |
| Réseau | Avatar URL externe (DiceBear) sans cache | 🔵 Faible |

---

## PERF-01 : Requêtes N+1 au démarrage de partie

**Localisation** : `server/server.js:146-162`

**Description** : Pour chaque joueur de la table, le serveur effectue **3 requêtes SQL distinctes** :
1. `SELECT wallet FROM users WHERE username = ?`
2. `UPDATE users SET wallet = wallet - ? WHERE username = ?`
3. `SELECT wallet FROM users WHERE username = ?` (pour relire le solde)

Avec 4 joueurs : **12 requêtes SQL** pour démarrer une partie. Avec une latence DB de 5ms, cela fait 60ms de blocage avant que les cartes soient distribuées.

```javascript
// Actuel — 12 requêtes pour 4 joueurs
for (let p of table.players) {
    const [userRows] = await db.query("SELECT wallet FROM users WHERE username = ?", [p.username]);
    // ...
    await db.query("UPDATE users SET wallet = wallet - ? WHERE username = ?", [table.stake, p.username]);
    await db.query("INSERT INTO transactions ...", [...]);
    const [newBal] = await db.query("SELECT wallet FROM users WHERE username = ?", [p.username]);
}
```

**Correction** : Transaction SQL unique avec opérations en lot :
```sql
-- 1 seule UPDATE en lot
UPDATE users SET wallet = wallet - 500
WHERE username IN ('Alice', 'Bob', 'Charlie', 'Dave')
AND wallet >= 500;

-- Vérifier le nombre de lignes affectées = nombre de joueurs
-- 1 seule INSERT en lot pour les transactions
INSERT INTO transactions (user_id, club_id, amount, type) VALUES
  (1, 1, -500, 'mise'),
  (2, 1, -500, 'mise'),
  (3, 1, -500, 'mise'),
  (4, 1, -500, 'mise');
```

---

## PERF-02 : Recherche par `username` au lieu de `id`

**Localisation** : `server/server.js` — toutes les requêtes SQL du socket

**Description** : Toutes les requêtes SQL de la logique de jeu utilisent `WHERE username = ?` au lieu de `WHERE id = ?`. Or :
- `username` n'est pas forcément indexé
- L'ID est stocké dans `socket.userId` mais ignoré pour les requêtes
- Une recherche par `id` (PK, cluster index) est **~10× plus rapide**

```javascript
// Actuel (lent)
await db.query("UPDATE users SET wallet = wallet + ? WHERE username = ?", [pot, winner.username]);

// Recommandé (rapide)
await db.query("UPDATE users SET wallet = wallet + ? WHERE id = ?", [pot, winner.userId]);
```

**Occurrences** :
- `join-table` : `SELECT id, wallet FROM users WHERE username = ?`
- `refresh-wallet` : `SELECT wallet FROM users WHERE username = ?`
- `start-game` : 3× `WHERE username = ?` par joueur
- `handleGameOver` : 2× `WHERE username = ?`

---

## PERF-03 : État de jeu en RAM sans persistence

**Localisation** : `server/server.js:35` — `let tables = {}`

**Description** : L'intégralité de l'état de toutes les parties en cours est stockée dans une variable JavaScript en mémoire RAM. Conséquences :

1. **Crash du serveur** → toutes les parties perdues, toutes les mises non remboursées
2. **Redémarrage nodemon** → idem
3. **Scaling horizontal impossible** → deux instances Node.js ne partagent pas le même `tables`
4. **Croissance mémoire incontrôlée** → si des tables ne sont jamais nettoyées (joueurs déconnectés sans `stand-up`)

**Correction recommandée** :
- Option A (rapide) : Redis pour l'état des tables
- Option B (robuste) : Persistance DB complète (`game_sessions` table)
- **Minimum** : Nettoyer les tables inactives après 30 minutes

```javascript
// Nettoyage des tables inactives (à ajouter)
setInterval(() => {
    const now = Date.now();
    for (const [tableId, table] of Object.entries(tables)) {
        if (table.players.length === 0 || (now - table.lastActivity > 30 * 60 * 1000)) {
            // Rembourser si partie en cours
            if (table.status === 'PLAYING') {
                refundAllPlayers(tableId, table);
            }
            delete tables[tableId];
        }
    }
}, 5 * 60 * 1000); // toutes les 5 minutes
```

---

## PERF-04 : Pas d'index sur les colonnes fréquemment requêtées

**Tables et colonnes concernées** :

| Table | Colonne | Requêtes | Index manquant |
|-------|---------|---------|----------------|
| `users` | `username` | Toutes les requêtes du socket | `INDEX idx_username (username)` |
| `users` | `phone` | Login, register | `UNIQUE idx_phone (phone)` (probable) |
| `users` | `role` | `getAllKatikas` | `INDEX idx_role (role)` |
| `users` | `club_id` | `getClubPlayers` | `INDEX idx_club_id (club_id)` |
| `transactions` | `user_id` | Historique joueur | `INDEX idx_user_id (user_id)` |
| `transactions` | `created_at` | Rapports temporels | `INDEX idx_created_at (created_at)` |
| `clubs` | `katika_id` | Dashboard Katika | `INDEX idx_katika_id (katika_id)` |

**Migration recommandée** :
```sql
ALTER TABLE users ADD INDEX idx_username (username);
ALTER TABLE users ADD INDEX idx_role (role);
ALTER TABLE users ADD INDEX idx_club_id (club_id);
ALTER TABLE transactions ADD INDEX idx_user_id (user_id);
ALTER TABLE transactions ADD INDEX idx_created_at (created_at);
ALTER TABLE clubs ADD INDEX idx_katika_id (katika_id);
```

---

## PERF-05 : Broadcasts excessifs de `player-list-update`

**Localisation** : `server/server.js` — émissions répétées

**Description** : `player-list-update` est émis à chaque événement (join, refresh, start-game, card-played, game-over) et transporte **l'objet complet de tous les joueurs** incluant les mains de cartes et les cartes passées.

```javascript
// Chaque émission envoie toutes les données de tous les joueurs
io.to(tableId).emit('player-list-update', table.players);
// table.players inclut : hand[], passedCards[] — données sensibles !
```

**Problèmes** :
1. Les mains des autres joueurs sont dans le payload (information sur les cartes adverses)
2. Le payload grossit avec le nombre de joueurs
3. Émis trop fréquemment

**Correction** :
```javascript
// Émettre une version "publique" sans les mains
function broadcastPlayerList(tableId, table) {
    const publicPlayers = table.players.map(p => ({
        id: p.id,
        username: p.username,
        wallet: p.wallet,
        avatar: p.avatar,
        isInHand: p.isInHand,
        isPassing: p.isPassing,
        cardCount: p.hand.length  // nombre de cartes, pas les cartes elles-mêmes
    }));
    io.to(tableId).emit('player-list-update', publicPlayers);
}
```

---

## PERF-06 : `setTimeout` bloquant dans la logique de pli

**Localisation** : `server/server.js:298-309`

```javascript
setTimeout(() => {
    if (playersWithCards.length === 0) {
        checkFinalReveal(...);
    } else {
        // nettoyer et passer au tour suivant
    }
}, 800);  // 800ms de délai hardcodé
```

**Description** : Ce `setTimeout(800ms)` est côté serveur pour créer un effet visuel de pause. Cela bloque le traitement de la partie et n'est pas adapté au backend. Les délais visuels appartiennent au client.

**Correction** : Émettre un événement `trick-ended` immédiatement, laisser le client attendre 800ms avant de demander la suite via `next-round`.

---

## PERF-07 : Avatar URL externe rechargée à chaque reconnexion

**Localisation** : `server/server.js:89`

```javascript
avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.username}`
```

**Description** : L'URL DiceBear est reconstruite à chaque connexion et l'image est rechargée par le navigateur à chaque session. Pas de cache côté serveur.

**Correction** : Stocker l'URL avatar dans la table `users` lors de la première connexion :
```sql
ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500) NULL;
```

---

## Plan d'optimisation prioritaire

| Priorité | ID | Action | Gain estimé |
|----------|----|--------|-------------|
| 🔴 P0 | PERF-01 | Grouper les requêtes SQL du start-game | -80% latence démarrage |
| 🔴 P0 | PERF-02 | Passer de `WHERE username` à `WHERE id` | -70% temps requêtes |
| 🟠 P1 | PERF-04 | Ajouter les index manquants | -50% temps de lecture |
| 🟠 P1 | PERF-05 | Masquer les mains dans player-list-update | Sécurité + réseau |
| 🟡 P2 | PERF-03 | Persist état via Redis ou nettoyage périodique | Stabilité |
| 🟡 P2 | PERF-06 | Déplacer setTimeout côté client | Architecture propre |
| 🔵 P3 | PERF-07 | Stocker avatar_url en DB | -N requêtes DiceBear |
