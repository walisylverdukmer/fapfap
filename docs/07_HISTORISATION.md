# 07 — Données à Historiser

> Date : 2026-06-15

---

## Définition

L'historisation consiste à **conserver une trace immuable** des états passés pour permettre :
- L'audit financier (litiges sur des mises ou des gains)
- Le rejeu de partie (debug, résolution de conflits)
- Les statistiques (analytics joueur, club, Wali)
- Le remboursement en cas de crash

---

## Données actuellement perdues (non historisées)

### 1. Parties jouées
**Donnée** : Chaque partie (game session) — qui a joué, qui a gagné, combien  
**Actuellement** : Stockée en RAM dans `tables{}`, effacée au redémarrage  
**Table à créer** : `game_sessions`

| Champ | Valeur à historiser |
|-------|---------------------|
| Joueurs participants | IDs des 2-4 joueurs |
| Dealer de la partie | ID du joueur |
| Mise par joueur | Montant de la stake |
| Pot total | stake × nb_joueurs |
| Gagnant | ID du joueur |
| Type de victoire | normal/koratte/carre/etc. |
| Horodatage début | `started_at` |
| Horodatage fin | `finished_at` |
| Durée | calculée |

---

### 2. Plis (tricks) joués
**Donnée** : Chaque pli — qui a joué quelle carte, qui a gagné le pli  
**Actuellement** : Jamais persisté (seulement dans `table.cardsOnTable`, réinitialisé à chaque pli)  
**Table à créer** : `game_rounds`

| Champ | Valeur à historiser |
|-------|---------------------|
| Numéro du pli | 1 à N |
| Cartes jouées | JSON [{user_id, card:{suit,value}}] |
| Joueur menant | ID |
| Gagnant du pli | ID |

---

### 3. Mains distribuées
**Donnée** : Les 5 cartes distribuées à chaque joueur  
**Actuellement** : Envoyées via Socket.IO, jamais stockées  
**Table à créer** : colonne `cards_dealt JSON` dans `game_players`

**Pourquoi historiser** :
- Détecter les biais du générateur aléatoire
- Résoudre les litiges ("j'avais un CARRÉ mais le jeu ne l'a pas reconnu")
- Audit des victoires spéciales

---

### 4. Actions PASS et BANQUE
**Donnée** : Qui a PASSé avec quelles cartes, qui a banqué et à quel moment  
**Actuellement** : Stocké dans `player.isPassing` / `player.isInHand` (RAM uniquement)

---

### 5. État du wallet avant/après chaque transaction
**Donnée** : Le solde avant et après chaque mouvement financier  
**Actuellement** : `transactions` stocke seulement `amount`, pas `balance_before` / `balance_after`

**Impact** : Sans ces champs, il est impossible de reconstituer l'historique de solde d'un joueur sans rejouer toutes ses transactions dans l'ordre.

```sql
-- À ajouter dans transactions
ALTER TABLE transactions
  ADD COLUMN balance_before DECIMAL(15,2) NOT NULL AFTER amount,
  ADD COLUMN balance_after  DECIMAL(15,2) NOT NULL AFTER balance_before;
```

---

### 6. Connexions et déconnexions
**Donnée** : Quand chaque joueur s'est connecté, déconnecté, depuis quelle IP  
**Actuellement** : `console.log('📱 Connecté :', socket.id)` — non persisté  
**Table à créer** : `audit_logs`

---

### 7. Changements de wallet par un admin
**Donnée** : Quand un Wali ou Katika modifie le wallet d'un joueur (hors jeu)  
**Actuellement** : `transactions` enregistre le transfert mais pas le contexte admin (qui a ordonné, pour quelle raison)

---

### 8. Commissions Wali
**Donnée** : La commission prélevée sur chaque pot (selon `commission_rate` du club)  
**Actuellement** : Logique absente — le Wali ne prélève rien automatiquement  
**Table à créer** : `commissions`

---

## Tableau de synthèse

| Donnée | Actuellement | Action requise | Urgence |
|--------|-------------|----------------|---------|
| Parties jouées (game_sessions) | RAM | Créer table | 🔴 Critique |
| Transactions : solde avant/après | Absent | ALTER TABLE | 🔴 Critique |
| Mains distribuées (cards_dealt) | Absent | Créer colonne JSON | 🟠 Élevé |
| Plis joués (game_rounds) | Absent | Créer table | 🟠 Élevé |
| PASS/BANQUE par partie | Absent | Créer colonne dans game_players | 🟡 Moyen |
| Connexions/déconnexions | Console.log | Créer audit_logs | 🟡 Moyen |
| Commissions Wali | Absent | Créer table + logique | 🟡 Moyen |
| Changements wallet admin | Partiel | Enrichir transactions | 🔵 Faible |

---

## Politique de rétention recommandée

| Donnée | Durée de rétention | Raison |
|--------|-------------------|--------|
| `transactions` | Illimitée | Obligation comptable/légale |
| `game_sessions` | 2 ans | Résolution litiges |
| `game_rounds` | 6 mois | Debug, puis archive froide |
| `game_players.cards_dealt` | 3 mois | Audit uniquement |
| `audit_logs` | 1 an | Sécurité |
| `recharge_requests` | 1 an | Suivi opérationnel |

---

## Implémentation : Séquence de persistence lors d'une partie

```
1. Player → join-table
   → UPSERT game_sessions (status='waiting')

2. Dealer → start-game
   → UPDATE game_sessions SET status='playing', started_at=NOW()
   → INSERT game_players (user_id, stake_paid, cards_dealt)
   → INSERT transactions (type='mise', balance_before, balance_after)

3. Player → card-played (fin de pli)
   → INSERT game_rounds (round_number, cards_played, winner_id)

4. handleGameOver()
   → UPDATE game_sessions SET winner_id, win_type, pot_total, status='finished', finished_at=NOW()
   → UPDATE game_players SET result='winner/loser/banque', gain_received
   → INSERT transactions (type='gain', balance_before, balance_after)
   → INSERT commissions (amount = pot * commission_rate)

5. Crash/déconnexion en cours de partie
   → UPDATE game_sessions SET status='cancelled'
   → INSERT transactions (type='remboursement') pour chaque joueur
```
