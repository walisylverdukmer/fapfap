# 02 — Schéma de Base de Données Actuel

> Reconstitué par reverse-engineering du code (aucun fichier de migration trouvé)
> Date : 2026-06-15

---

## Avertissement

Il n'existe **aucun fichier de migration SQL** dans le projet. Le schéma ci-dessous est **reconstitué entièrement depuis le code source** (`authController.js`, `moneyController.js`, `server.js`, `init_db.js`, `seed.js`).

---

## Tables existantes : 3

---

### Table `users`

```sql
CREATE TABLE users (
  id         INT           PRIMARY KEY AUTO_INCREMENT,
  username   VARCHAR(255)  UNIQUE NOT NULL,
  phone      VARCHAR(20)   UNIQUE NOT NULL,
  password   VARCHAR(255)  NOT NULL,          -- bcrypt hash
  role       ENUM('superadmin','katika','player') NOT NULL,
  wallet     DECIMAL(15,2) DEFAULT 0,
  club_id    INT           NULL,              -- FK clubs.id (ajouté après création pour Katika)
  created_at TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (club_id) REFERENCES clubs(id)
);
```

**Problèmes identifiés :**
- `club_id` est NULL pour le Wali et peut être NULL pour les Katikas au moment de leur création (mis à jour juste après via UPDATE)
- Pas de champ `status` (actif/inactif/suspendu)
- Pas de champ `last_login`
- Le `role` devrait être extensible (mais ENUM le bloque)
- La requête dans le code utilise `WHERE username = ?` (pas `WHERE id = ?`) — **risque si username change**

**Données observées dans `init_db.js` :**
```
Wali Sylver | phone: 0700000001 | role: superadmin | wallet: 1,000,000 | club_id: 1
```

---

### Table `clubs`

```sql
CREATE TABLE clubs (
  id         INT           PRIMARY KEY AUTO_INCREMENT,
  name       VARCHAR(255)  NOT NULL,
  katika_id  INT           NOT NULL,          -- FK users.id
  created_at TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (katika_id) REFERENCES users(id)
);
```

**Problèmes identifiés :**
- Pas de `stake_default` (mise par défaut de la table — actuellement hardcodé 500 côté Socket.IO)
- Pas de `max_players` (actuellement hardcodé 4 côté Socket.IO)
- Pas de `status` (ouvert/fermé/suspendu)
- Pas de `commission_rate` pour que Wali prélève une commission
- Pas de `balance` propre au club (la trésorerie de Katika est dans `users.wallet`)

---

### Table `transactions`

```sql
CREATE TABLE transactions (
  id         INT           PRIMARY KEY AUTO_INCREMENT,
  user_id    INT           NOT NULL,           -- FK users.id (receveur/concerné)
  club_id    INT           NULL,               -- FK clubs.id
  amount     DECIMAL(15,2) NOT NULL,           -- négatif = débit, positif = crédit
  type       ENUM('mise','gain','transfert') NOT NULL,
  sender_id  INT           NULL,               -- FK users.id (pour les transferts)
  created_at TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id)   REFERENCES users(id),
  FOREIGN KEY (club_id)   REFERENCES clubs(id),
  FOREIGN KEY (sender_id) REFERENCES users(id)
);
```

**Problèmes identifiés :**
- Pas de `game_session_id` — impossible de lier une transaction à une partie précise
- Pas de `status` (pending/confirmed/cancelled) — les transferts n'ont pas d'état
- Pas de contrainte sur `amount` (peut être 0 ou négatif sans logique)
- Le champ `amount` est parfois négatif (mise = -500), parfois positif (gain = 1500) — incohérent
- Pas de type `recharge` ou `commission`

---

## Diagramme actuel (texte)

```
users                          clubs
─────────────────────          ──────────────────────
id (PK)                        id (PK)
username (UNIQUE)              name
phone (UNIQUE)    ←────────┐   katika_id (FK→users.id)
password                   │   created_at
role                        │
wallet                     │
club_id (FK→clubs.id) ─────┤
created_at                 │
                           │
transactions               │
──────────────────────     │
id (PK)                    │
user_id (FK→users.id) ─────┤
club_id (FK→clubs.id)      │
amount                     │
type                       │
sender_id (FK→users.id) ───┘
created_at
```

---

## État des données en mémoire (non persistées)

L'objet `tables` dans `server.js` contient l'état complet de chaque partie en RAM. Ces données sont **perdues au redémarrage du serveur** :

```javascript
tables["club_1"] = {
  players: [
    {
      id: socket.id,        // ID Socket (temporaire)
      username: string,
      wallet: number,
      hand: [{suit, value}],
      avatar: string,
      isInHand: boolean,
      isPassing: boolean,
      passedCards: [{suit, value}]
    }
  ],
  pot: number,
  stake: number,            // Défaut: 500 FCFA
  status: 'WAITING' | 'PLAYING',
  turnIndex: number,
  dealerIndex: number,
  cardsOnTable: [{playerId, username, card}],
  cardsPlayedInRound: number,
  clubId: number
}
```

**Données jamais persistées :**
- L'historique des plis joués
- Les mains distribuées
- Les PASS et BANQUE intermédiaires
- Les tours de jeu
- L'identité du dealer au fil des parties
- Les victoires spéciales (KORATTE, CARRÉ, etc.)

---

## Tables inutilisées / manquantes

| Statut | Table | Note |
|--------|-------|------|
| ❌ Manquante | `game_sessions` | Aucune trace des parties |
| ❌ Manquante | `game_rounds` | Aucun historique des plis |
| ❌ Manquante | `game_players` | Liaison partie↔joueur |
| ❌ Manquante | `commissions` | Logique prévue mais pas implémentée |
| ❌ Manquante | `recharge_requests` | Endpoint stub `/api/money/recharge` |
| ❌ Manquante | `audit_logs` | Traçabilité des actions admin |
| ⚠️ Incomplète | `transactions` | Manque game_session_id, status |
| ⚠️ Incomplète | `clubs` | Manque stake_default, commission_rate, status |
| ⚠️ Incomplète | `users` | Manque status, last_login |
