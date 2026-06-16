# FAP FAP — Rapport Technique Sprint 2 : Économie

**Date :** 2026-06-16  
**Environnement :** Neon PostgreSQL 18.4 + Node.js 22 / Express 5 / Socket.IO 4  
**Scope :** BUG-05 Commission 5% + BUG-13 Recharges

---

## 1. Objectifs et statut

| Objectif | Statut |
|---|---|
| Prélever automatiquement la commission 5% | ✅ Implémenté |
| Alimenter la table `commissions` | ✅ Implémenté |
| Créditer le Wali | ✅ Implémenté |
| Implémenter `recharge_requests` (CRUD complet) | ✅ Implémenté |
| Endpoint : demande de recharge | ✅ Implémenté |
| Endpoint : validation de recharge | ✅ Implémenté |
| Endpoint : refus de recharge | ✅ Implémenté |
| Journaliser toutes les opérations financières | ✅ Implémenté |
| Règles du jeu inchangées | ✅ Confirmé |

---

## 2. Fichiers modifiés / créés

| Fichier | Action | Description |
|---|---|---|
| `server/server.js` | Modifié | Tracking game_sessions + commissions + winType |
| `server/controllers/rechargeController.js` | Créé | CRUD complet recharges (4 fonctions) |
| `server/routes/moneyRoutes.js` | Modifié | 4 nouvelles routes recharges |
| `server/controllers/moneyController.js` | Modifié | Suppression du stub requestRecharge |

---

## 3. BUG-05 — Commission 5% (complet)

### Architecture finale

```
FIN DE PARTIE (handleGameOver)
  ├── clubs → commission_rate + katika_id
  ├── pot × rate = commission
  ├── pot - commission = winnerGain
  ├── UPDATE users (gagnant) +winnerGain
  ├── INSERT transactions (type='gain')
  ├── UPDATE users (Wali) +commission
  ├── INSERT transactions (type='commission')
  ├── UPDATE game_sessions (winner_id, commission, pot_total, win_type, status='finished')
  ├── INSERT commissions (game_session_id, wali_id, katika_id, rate, amount, status='paid')
  └── INSERT audit_logs (action='game_finished')
```

### Tracking game_sessions

Ajout dans `start-game` (Socket.IO) — Phase 3 :

```js
if (dealer.dbId) {
    const { rows: gsRows } = await db.query(
        `INSERT INTO game_sessions (club_id, dealer_id, stake, nb_players, status, started_at)
         VALUES ($1, $2, $3, $4, 'playing', NOW())
         RETURNING id`,
        [data.club_id, dealer.dbId, table.stake, table.players.length]
    );
    table.gameSessionId = gsRows[0].id;
}
```

Le `game_session_id` est stocké dans `table.gameSessionId` et utilisé à la fin de la partie.

### Types de victoire (win_type)

| Événement | win_type |
|---|---|
| Dernier pli normal / FIN DE MANCHE | `normal` |
| Dernier pli avec un 3 (KORATTE final) | `koratte` |
| Claim TCHIA | `tchia` |
| Claim 3 SEPT | `trois_sept` |
| Claim CARRÉ | `carre` |
| Claim COULEUR | `couleur` |
| Claim KORATTE | `koratte` |
| TOUS BANQUÉ | `tous_banque` |

### dbId dans les joueurs

`socket.userId` (DB id) est désormais stocké dans l'objet joueur :
```js
table.players.push({ id: socket.id, dbId: socket.userId || null, ... });
```

Cela permet d'insérer `dealer_id` et `winner_id` dans `game_sessions` sans subquery supplémentaire.

---

## 4. BUG-13 — Recharges (complet)

### Nouveau fichier : `server/controllers/rechargeController.js`

#### 4 endpoints

| Méthode | Route | Rôle | Description |
|---|---|---|---|
| POST | `/api/money/recharge` | Tous | Créer une demande |
| GET | `/api/money/recharges` | Tous | Lister les demandes (filtrées par rôle) |
| PUT | `/api/money/recharges/:id/approve` | Katika / Wali | Valider et créditer |
| PUT | `/api/money/recharges/:id/reject` | Katika / Wali | Refuser |

#### Logique d'approbation

```
PUT /api/money/recharges/:id/approve
  ├── Vérifier statut = 'pending'
  ├── Vérifier appartenance au club (Katika uniquement)
  ├── Si Katika :
  │     ├── Lire wallet Katika
  │     ├── Vérifier solde suffisant
  │     ├── UPDATE users (Katika) -amount
  │     └── INSERT transactions (type='transfert', amount négatif)
  ├── Lire wallet cible avant crédit
  ├── UPDATE users (cible) +amount
  ├── INSERT transactions (type='recharge', sender_id=reviewer)
  ├── UPDATE recharge_requests (status='approved', reviewed_by, reviewed_at)
  └── INSERT audit_logs (action='recharge_approved')
```

**Note :** Le Wali approuve sans débit de son propre wallet (même logique que `transferFunds`).

#### Filtres GET /api/money/recharges

| Rôle | Demandes visibles |
|---|---|
| `superadmin` (Wali) | Toutes |
| `katika` | Joueurs de son club + ses propres demandes |
| `player` | Ses propres demandes (requester ou target) |

Paramètre optionnel `?status=pending|approved|rejected`.

---

## 5. Journalisation (`audit_logs`)

Toutes les opérations critiques sont enregistrées dans `audit_logs` :

| Action | Déclencheur | Contenu new_value |
|---|---|---|
| `recharge_request` | POST /recharge | `{amount, target_id}` |
| `recharge_approved` | PUT /approve | `{amount, target, reviewer_role, balance_before, balance_after}` |
| `recharge_rejected` | PUT /reject | `{note}` |
| `game_finished` | handleGameOver | `{winner, win_type, pot, commission, winner_gain}` |

---

## 6. Tests réalisés

### 12 tests recharges (tous ✅)

| # | Test | Résultat attendu | Résultat |
|---|---|---|---|
| T01 | Joueur crée recharge pour lui-même | 201 + request_id | ✅ |
| T02 | Wali crée recharge pour un joueur | 201 + request_id | ✅ |
| T03 | Joueur tente de recharger quelqu'un d'autre | 403 | ✅ |
| T04 | Wali liste toutes les demandes | 3 demandes affichées | ✅ |
| T05 | Filtre `?status=pending` | 3 pending | ✅ |
| T06 | Katika approuve demande Moussa (+5 000) | 200 + balance_after=22 000 | ✅ |
| T07 | Vérification wallet Moussa | 22 000 FCFA | ✅ |
| T08 | Wali approuve demande Fatou (sans débit) | 200 + balance_after=9 500 | ✅ |
| T09 | Réapprouver demande déjà traitée | 400 "déjà traitée" | ✅ |
| T10 | Créer + refuser une demande | 201 puis 200 "refusée" | ✅ |
| T11 | Player tente d'approuver | 403 | ✅ |
| T12 | Demande inexistante | 404 | ✅ |

### État DB après tests

| Utilisateur | Wallet avant | Wallet après | Variation |
|---|---|---|---|
| Katika_Issa | 44 500 FCFA | 39 500 FCFA | −5 000 (recharge Moussa) |
| Joueur_Moussa | 17 000 FCFA | 22 000 FCFA | +5 000 (approuvé par Katika) |
| Joueur_Fatou | 7 500 FCFA | 9 500 FCFA | +2 000 (approuvé par Wali) |
| Wali_FAP | 1 000 000 FCFA | 1 000 000 FCFA | 0 (pas débité) |

Commissions et transactions enregistrées avec `balance_before` / `balance_after` corrects.

---

## 7. Exemples d'utilisation

### Flux complet recharge joueur

```bash
# 1. Joueur demande une recharge
curl -X POST http://localhost:5000/api/money/recharge \
  -H "Authorization: Bearer $TOKEN_JOUEUR" \
  -H "Content-Type: application/json" \
  -d '{"amount": 10000, "note": "J'\''ai besoin de fonds pour jouer ce soir"}'
# → {"msg": "Demande de recharge envoyée...", "request_id": 5}

# 2. Katika consulte les demandes en attente de son club
curl "http://localhost:5000/api/money/recharges?status=pending" \
  -H "Authorization: Bearer $TOKEN_KATIKA"
# → [{"id":5, "target_name":"Joueur_Moussa", "amount":10000, "status":"pending", ...}]

# 3. Katika approuve
curl -X PUT http://localhost:5000/api/money/recharges/5/approve \
  -H "Authorization: Bearer $TOKEN_KATIKA"
# → {"msg":"Recharge de 10000 FCFA approuvée pour Joueur_Moussa.", "balance_after": 32000}

# 4. Katika refuse une demande avec motif
curl -X PUT http://localhost:5000/api/money/recharges/6/reject \
  -H "Authorization: Bearer $TOKEN_KATIKA" \
  -H "Content-Type: application/json" \
  -d '{"note": "Demande en doublon, annulation."}'
# → {"msg": "Demande de recharge refusée."}
```

### Flux commission après partie

Le flux est 100% automatique côté Socket.IO — aucun appel API requis :

```
1. start-game  → INSERT game_sessions (status='playing')
2. fin de partie (dernier pli ou victoire spéciale)
   → handleGameOver(pot=2000, commissionRate=5%)
   → commission = 100 FCFA
   → gagnant +1900 FCFA (INSERT transactions type='gain')
   → Wali +100 FCFA    (INSERT transactions type='commission')
   → UPDATE game_sessions (winner_id, commission=100, status='finished')
   → INSERT commissions  (game_session_id, rate=0.05, amount=100, status='paid')
   → INSERT audit_logs   (action='game_finished')
```

### Vérifier les commissions d'un club (requête DB directe)

```sql
SELECT gs.id, gs.stake, gs.pot_total, gs.win_type, gs.finished_at,
       u.username AS winner,
       c.amount AS commission, c.rate,
       w.username AS wali
FROM game_sessions gs
JOIN commissions c ON c.game_session_id = gs.id
JOIN users u ON u.id = gs.winner_id
JOIN users w ON w.id = c.wali_id
WHERE gs.club_id = 1
ORDER BY gs.finished_at DESC;
```

---

## 8. Contraintes et limites

- **commissions.katika_id NOT NULL** : si un club n'a pas de katika_id défini, l'entrée `commissions` n'est pas insérée (la transaction wallet reste faite). Cela ne bloque pas la partie.
- **game_sessions.dealer_id NOT NULL** : si `dealer.dbId` est null (connexion socket sans lookup DB), la session n'est pas créée. Non-bloquant — la partie continue.
- **Wali illimité** : lors de l'approbation d'une recharge par le Wali, son wallet n'est pas débité, conformément à la logique existante de `transferFunds`.
- **Pas de transaction SQL** : les opérations multi-tables (débit + crédit + log) sont séquentielles sans `BEGIN/COMMIT`. En cas d'interruption réseau entre deux requêtes, l'état peut être partiellement enregistré. À corriger dans un sprint ultérieur (Sprint 3 — Robustesse).

---

## 9. Prochaines étapes suggérées

- [ ] Ajouter `BEGIN/COMMIT` dans `approveRecharge` et `handleGameOver` (atomicité)
- [ ] Notification Socket.IO au joueur quand sa recharge est approuvée/refusée
- [ ] Endpoint `GET /api/money/transactions` — historique paginé par utilisateur
- [ ] Interface admin (Katika) pour gérer les recharges depuis le client web
- [ ] Insertion dans `game_players` pour le détail des joueurs par session
