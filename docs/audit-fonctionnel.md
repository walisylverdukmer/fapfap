# FAP FAP — Audit Fonctionnel Complet

**Date :** 2026-06-16  
**Sources analysées :**
- `server/server.js` — logique Socket.IO (455 lignes)
- `server/controllers/authController.js` — auth / inscription
- `server/controllers/moneyController.js` — finances
- `client/game.js` — logique client (508 lignes)
- `docs/schema-postgresql.sql` — schéma PostgreSQL complet

**Légende :**
- ✅ **Implémentée** — présente et fonctionnelle
- ⚠️ **Partiellement implémentée** — logique existante mais incomplète ou défectueuse
- ❌ **Non implémentée** — absente du code

---

## 1. Distribution des cartes

**Statut : ✅ Implémentée**

**Fichier :** `server/server.js` lignes 199–213

```js
let deck = [];
const suits = ['spade', 'heart', 'club', 'diamond'];
for (const s of suits) {
    for (let v = 3; v <= 10; v++) deck.push({ suit: s, value: v });
}
deck = deck.sort(() => Math.random() - 0.5);
table.players.forEach(p => {
    p.hand = deck.splice(0, 5);
    io.to(p.id).emit('receive-cards', { hand: p.hand, turn: ... });
});
```

**Ce qui fonctionne :**
- Jeu de 32 cartes construit correctement (valeurs 3–10, 4 couleurs = 32 cartes)
- 5 cartes distribuées à chaque joueur, envoyées uniquement au destinataire (via `socket.id`)
- Le flag `turn` indique au premier joueur que c'est son tour
- Pour 4 joueurs : 20 cartes distribuées, 12 non utilisées (conforme FAP FAP)

**Défaut mineur :**
- `Array.sort(() => Math.random() - 0.5)` n'est pas un mélange cryptographiquement uniforme (biais vers les premières positions). L'algorithme Fisher-Yates serait préférable pour éviter tout biais prédictible.

---

## 2. Gestion des manches

**Statut : ⚠️ Partiellement implémentée**

**Fichiers :** `server/server.js` lignes 188–191, 285–308 | `client/game.js` lignes 360–378, 398–403

**Ce qui fonctionne :**
- `start-game` initialise correctement `table.status = 'PLAYING'`
- Le premier joueur est celui à gauche du dealer : `(dealerIndex - 1 + n) % n`
- `passTurn()` avance vers la gauche (décrémentation d'index) — cohérent avec le sens de jeu
- Après chaque pli, `table.cardsOnTable = []` est vidé côté serveur et `next-turn` est émis

**Bug critique — `cardsPlayedInRound` non maintenu côté serveur :**

```js
// server.js start-game
table.cardsPlayedInRound = 0;  // Initialisé...

// server.js fold-hand
if (table.cardsPlayedInRound >= 2) return;  // Vérifié...

// server.js card-played : JAMAIS MIS À JOUR ❌
```

La vérification `table.cardsPlayedInRound >= 2` vaut toujours `false` car la variable n'est jamais incrémentée côté serveur. Conséquence : un joueur peut banker n'importe quand pendant toute la partie, même après avoir vu de nombreuses cartes jouées.

**Bug — Absence de l'événement `clear-table` :**

Le client a un handler `socket.on('clear-table', ...)` qui réinitialise les zones de jeu entre les plis. Le serveur n'émet jamais cet événement. Sans cela, les cartes des plis précédents s'accumulent visuellement sur la table au fur et à mesure de la partie.

**Bug — `cardsPlayedInRound` ne se remet pas à zéro entre les plis côté client :**

```js
// game.js — receive-cards : reset ✅
cardsPlayedInRound = 0;
// game.js — game-started : reset ✅
cardsPlayedInRound = 0;
// Entre deux plis (next-turn) : PAS DE RESET ❌
```

À partir du 2ème pli, le bouton BANQUE n'apparaît plus côté client car `cardsPlayedInRound` dépasse 2 et ne revient jamais à 0 entre les plis.

---

## 3. Gestion des levées (plis)

**Statut : ⚠️ Partiellement implémentée**

**Fichier :** `server/server.js` lignes 311–335

```js
function determineTrickWinner(tableId, table, club_id) {
    const leadingCard = table.cardsOnTable[0].card;
    let winnerEntry = table.cardsOnTable[0];
    for (let i = 1; i < table.cardsOnTable.length; i++) {
        const challenger = table.cardsOnTable[i];
        if (challenger.card.suit === leadingCard.suit && challenger.card.value > winnerEntry.card.value) {
            winnerEntry = challenger;
        }
    }
    ...
}
```

**Ce qui fonctionne :**
- Détermination correcte du gagnant : carte la plus haute de la couleur menante
- Seules les cartes de la couleur de tête peuvent battre
- Le gagnant du pli devient le prochain à mener (`turnIndex` mis à jour)
- Délai de 800ms avant de passer au prochain pli (lisibilité côté client)

**Bug — Pas d'enforcement de la "suite de couleur" (suivre la couleur) :**

Le serveur accepte n'importe quelle carte du joueur sans vérifier s'il possède une carte de la couleur menante. Un joueur peut défausser une carte d'une autre couleur même s'il a la couleur menante en main, ce qui peut fausser le résultat du pli.

**Bug — Zones de jeu non vidées entre les plis :**

Le serveur vide `table.cardsOnTable` mais n'envoie pas d'événement de nettoyage visuel au client entre deux plis consécutifs. L'événement `clear-table` (attendu par `game.js` ligne 389) n'est jamais émis.

---

## 4. Calcul du vainqueur final

**Statut : ⚠️ Partiellement implémentée**

**Fichier :** `server/server.js` lignes 338–371

```js
function checkFinalReveal(tableId, lastWinnerObj, lastCard, isFinalKoratte, club_id) {
    const passers = table.players.filter(p => p.isPassing);
    let finalWinner = lastWinnerObj;
    let finalCardVal = lastCard;

    passers.forEach(p => {
        const bestPassCard = p.passedCards.sort((a, b) => b.value - a.value)[0];
        if (finalCardVal && bestPassCard.suit === finalCardVal.suit && bestPassCard.value > finalCardVal.value) {
            finalWinner = p;
            finalCardVal = bestPassCard;
        } else if (!finalWinner) {
            finalWinner = p;
            finalCardVal = bestPassCard;
        }
    });
    ...
}
```

**Ce qui fonctionne :**
- Le gagnant du dernier pli est comparé aux passeurs
- Le gagnant final est désigné et son wallet est crédité via `handleGameOver`
- `TOUS BANQUÉ` : dernier joueur restant remporte le pot (ligne 239)

**Bug — Comparaison entre passeurs incorrecte :**

Si plusieurs joueurs sont PASS, leur comparaison est défectueuse. La carte d'un passeur n'est retenue que si elle est de la **même couleur** que la carte gagnante précédente. Si tous les joueurs ont passé (aucun actif n'a joué de pli), `lastWinnerObj` et `lastCard` sont `null`. Dans ce cas :
- Le premier passeur devient automatiquement `finalWinner`  
- Les passeurs suivants ne sont **jamais comparés entre eux** (condition `else if (!finalWinner)` ne s'exécute plus)
- Le premier passeur dans la liste gagne toujours, indépendamment de ses cartes

**Bug — `passedCards.sort()` mute le tableau original :**

`.sort()` est appliqué directement sur `p.passedCards` (mutant). Bien que sans conséquences dans ce contexte précis, c'est une pratique risquée.

---

## 5. Règle du 21 (TCHIA)

**Statut : ⚠️ Partiellement implémentée**

**Fichiers :** `client/game.js` lignes 263–271 | `server/server.js` lignes 421–428

**Détection côté client :**
```js
const totalPoints = values.reduce((a, b) => a + b, 0);
if (totalPoints <= 21) createBonusButton(`TCHIA (${totalPoints})`, "TCHIA");
```
La détection est correcte : somme des valeurs des 5 cartes ≤ 21.

**Traitement côté serveur :**
```js
socket.on('claim-special-victory', (data) => {
    const finalPot = data.type === 'KORATTE' ? table.pot * 2 : table.pot;
    handleGameOver(tableId, winner, finalPot, data.reason, data.club_id);
});
```

**Vulnérabilité critique — Zéro validation serveur :**

Le serveur accepte `claim-special-victory` sans vérifier les cartes réelles du joueur. N'importe qui peut envoyer `socket.emit('claim-special-victory', { type: 'TCHIA', reason: 'TCHIA' })` depuis la console du navigateur et remporter le pot instantanément sans avoir un TCHIA réel.

---

## 6. Trois 7 (TROIS_SEPT)

**Statut : ⚠️ Partiellement implémentée**

**Fichier :** `client/game.js` ligne 271

```js
if (values.filter(v => v === 7).length >= 3) createBonusButton("3 SEPT", "3 SEPT");
```

**Ce qui fonctionne :** Détection client correcte (≥ 3 cartes de valeur 7).

**Manquant :** Validation côté serveur des cartes réelles. Même vulnérabilité que TCHIA.

**Note :** Avec 5 cartes distribuées sur 32 (4 cartes de valeur 7 dans le deck), avoir 3 sept en main est possible mais rare.

---

## 7. Quatre cartes identiques (CARRÉ)

**Statut : ⚠️ Partiellement implémentée**

**Fichier :** `client/game.js` ligne 269

```js
const counts = {};
values.forEach(v => counts[v] = (counts[v] || 0) + 1);
if (Object.values(counts).some(count => count >= 4)) createBonusButton("CARRÉ !", "CARRE");
```

**Ce qui fonctionne :** Détection client correcte (4 cartes de même valeur sur 5).

**Manquant :** Validation côté serveur. Même vulnérabilité que TCHIA et TROIS_SEPT.

---

## 8. Cinq cartes du même groupe (COULEUR / KORATTE)

**Statut : ⚠️ Partiellement implémentée**

**Fichier :** `client/game.js` lignes 272–275

```js
if (suits.every(s => s === suits[0])) {
    const hasThree = values.includes(3);
    createBonusButton(
        hasThree ? "KORATTE (X2) !" : "COULEUR !",
        hasThree ? "KORATTE" : "COULEUR"
    );
}
```

**Ce qui fonctionne :**
- Détection correcte de 5 cartes de même couleur
- Distinction entre COULEUR (sans 3 = pot normal) et KORATTE (avec 3 = pot ×2)
- Côté serveur, le doublement est bien appliqué pour `type === 'KORATTE'`

**Manquant :**
- Validation serveur des cartes réelles (même vulnérabilité)
- La COULEUR sans 3 donne le pot normal, ce qui est cohérent, mais non documenté

---

## 9. Règle Passe

**Statut : ⚠️ Partiellement implémentée**

**Fichiers :** `server/server.js` lignes 247–259 | `client/game.js` lignes 233–245

**Conditions serveur :**
```js
if (player && player.hand.length === 2 && table.players[table.turnIndex].id === socket.id) {
    player.isPassing = true;
    player.passedCards = [...player.hand];
    player.hand = [];
    passTurn(tableId);
}
```

**Ce qui fonctionne :**
- Conditions correctes : exactement 2 cartes en main ET c'est le tour du joueur
- Les 2 cartes sont sauvegardées dans `passedCards` (pour la révélation finale)
- Le tour passe au joueur suivant
- Côté client : bouton PASS correctement affiché quand `myHand.length === 2 && isMyTurn`

**Défauts :**
- La révélation des cartes PASS en fin de manche souffre du bug décrit au point 4 (comparaison inter-passeurs défectueuse)
- Aucune règle sur le nombre maximum de passeurs dans une même partie (pourraient-ils tous passer ?)
- Si tous les joueurs passent : `lastWinnerObj = null, lastCard = null` → le premier passeur dans le tableau gagne toujours

---

## 10. Victoire avec un 3 (KORATTE automatique)

**Statut : ✅ Implémentée**

**Fichier :** `server/server.js` lignes 325–327

```js
checkFinalReveal(
    tableId, winnerObj, winnerEntry.card,
    (winnerEntry.card.value === 3),  // ← KORATTE si 3
    club_id
);
```

Et dans `checkFinalReveal` :
```js
const currentPot = isFinalKoratte ? table.pot * 2 : table.pot;
const reason = isFinalKoratte ? "KORATTE (3 final)" : "FIN DE MANCHE";
```

**Ce qui fonctionne :**
- Si le dernier pli est remporté avec une carte de valeur 3, le pot est automatiquement doublé
- La raison `"KORATTE (3 final)"` est transmise au client pour affichage
- Ce doublement est appliqué côté serveur, pas déclarable par le client (non manipulable)

---

## 11. Doublement du pot (KORATTE ×2)

**Statut : ✅ Implémentée**

**Fichier :** `server/server.js` lignes 365, 426

Deux déclencheurs :

| Déclencheur | Code | Sécurité |
|---|---|---|
| Fin de manche avec un 3 | `isFinalKoratte ? pot * 2 : pot` | ✅ Côté serveur |
| Déclaration KORATTE (5 mêmes couleurs + 3) | `data.type === 'KORATTE' ? pot * 2 : pot` | ⚠️ Client non validé |

**Ce qui fonctionne :** Le doublement est effectif dans les deux cas.

**Défaut :** Le KORATTE déclaré via `claim-special-victory` n'est pas validé côté serveur (vulnérabilité identifiée au point 8).

---

## 12. Commission 5 %

**Statut : ❌ Non implémentée**

**Schéma :** `clubs.commission_rate NUMERIC(5,4) NOT NULL DEFAULT 0.0500` ✅  
**Table :** `commissions` (9 colonnes, FK vers game_sessions, clubs, users) ✅ Définie

**Code dans `handleGameOver` :**
```js
// Crédite le gagnant avec le pot ENTIER — aucune commission
await db.query(
    "UPDATE users SET wallet = wallet + $1 WHERE username = $2",
    [pot, winner.username]
);
```

**Aucune ligne de code ne :**
- Calcule la commission (`pot × commission_rate`)
- Débite la commission du pot avant de créditer le gagnant
- Crédite le Wali
- Insère une ligne dans la table `commissions`

**Impact :** Chaque partie, le Wali perd 5% du pot (non perçus). Sur une mise de 500 FCFA × 4 joueurs = pot 2000 FCFA, la commission manquante est 100 FCFA par partie.

---

## 13. Recharges

**Statut : ❌ Non implémentée (stub)**

**Fichier :** `server/controllers/moneyController.js` lignes 117–119

```js
exports.requestRecharge = async (req, res) => {
    res.json({ msg: "Demande reçue. En attente de validation par l'administration." });
};
```

**Ce qui manque :**
- `INSERT INTO recharge_requests` — la table existe, le code ne l'utilise pas
- Notification au Katika / Wali (Socket.IO ou autre)
- Endpoint de validation/rejet (Katika ou Wali approuve)
- Débit automatique du Katika et crédit du joueur à la validation
- Historique consultable

**Côté client :** `player-view.html` a un formulaire de recharge, mais `requestMoney()` n'est pas définie. Le bouton ne fait rien.

---

## 14. Sanctions

**Statut : ❌ Non implémentée**

**Schéma :** `users.status user_status NOT NULL DEFAULT 'active'` — ENUM `active / suspended / inactive` ✅ Défini

**Code dans `authController.login` :**
```js
const { rows: users } = await db.query("SELECT * FROM users WHERE phone = $1", [phone]);
if (users.length === 0) { return res.status(400).json({ msg: "Identifiants incorrects." }); }
// PAS DE VÉRIFICATION DE users[0].status ❌
const isMatch = await bcrypt.compare(password, user.password);
```

Un utilisateur avec `status = 'suspended'` peut se connecter normalement. La colonne existe en base mais n'est jamais lue dans la logique applicative.

**Ce qui manque :**
- Vérification du statut à la connexion
- Endpoint admin `PUT /api/admin/users/:id/suspend`
- Vérification du statut avant `join-table` (Socket.IO)
- Interface admin pour gérer les statuts

---

## 15. Exclusion pour triche

**Statut : ❌ Non implémentée**

**Ce qui existe :**
- Table `audit_logs` (BIGSERIAL, 11 colonnes, FK users) ✅ Définie, jamais utilisée
- Colonne `users.status` (point 14) — pourrait servir à l'exclusion

**Ce qui manque complètement :**

1. **Validation des victoires spéciales côté serveur** — `claim-special-victory` accepte toute déclaration sans vérifier les cartes réelles du joueur :
   ```js
   // Actuellement :
   const winner = table?.players.find(p => p.id === socket.id);
   if (!winner || !winner.isInHand) return;  // seule vérification
   // Aucune vérification de p.hand ❌
   ```

2. **Détection de comportements suspects :**
   - Pas de rate-limiting sur les événements Socket.IO
   - Pas de détection de déclarations invalides répétées
   - Pas de logs d'audit lors des victoires spéciales

3. **Processus d'exclusion :**
   - Aucun endpoint pour bannir un joueur en cours de partie
   - Aucune déconnexion forcée possible
   - Aucune remontée d'alerte au Wali / Katika

4. **Bouton de triche en clair dans le code client :**
   ```js
   // game.js ligne 144–152 — Bouton "+" visible de tous les joueurs
   cheatBtn.title = "Cheat: Ajouter 5000 FCFA (Test)";
   cheatBtn.onclick = testAddMoney;
   ```
   Ce bouton de test est visible de tous les joueurs. Bien qu'il ne fasse rien de dangereux (il affiche une alerte et fait `refresh-wallet`), sa présence est à supprimer en production.

---

## Tableau de synthèse

| # | Règle | Statut | Fichier principal | Priorité de correction |
|---|---|---|---|---|
| 1 | Distribution des cartes | ✅ Implémentée | `server.js:199` | Faible (améliorer shuffle) |
| 2 | Gestion des manches | ⚠️ Partielle | `server.js:188`, `game.js:360` | **Haute** |
| 3 | Gestion des levées | ⚠️ Partielle | `server.js:311` | **Haute** |
| 4 | Calcul du vainqueur | ⚠️ Partielle | `server.js:338` | **Haute** |
| 5 | Règle du 21 (TCHIA) | ⚠️ Partielle | `game.js:270`, `server.js:421` | **Critique** |
| 6 | Trois 7 | ⚠️ Partielle | `game.js:271`, `server.js:421` | **Critique** |
| 7 | Quatre cartes identiques | ⚠️ Partielle | `game.js:269`, `server.js:421` | **Critique** |
| 8 | Cinq cartes même groupe | ⚠️ Partielle | `game.js:272`, `server.js:421` | **Critique** |
| 9 | Règle Passe | ⚠️ Partielle | `server.js:247`, `game.js:233` | **Haute** |
| 10 | Victoire avec un 3 | ✅ Implémentée | `server.js:325` | — |
| 11 | Doublement du pot | ✅ Implémentée | `server.js:365`, `server.js:426` | Moyenne (valider côté serveur) |
| 12 | Commission 5 % | ❌ Non implémentée | `server.js:374` (absent) | **Haute** |
| 13 | Recharges | ❌ Non implémentée | `moneyController.js:117` | **Haute** |
| 14 | Sanctions | ❌ Non implémentée | `authController.js:109` | Moyenne |
| 15 | Exclusion pour triche | ❌ Non implémentée | `server.js:421` | **Critique** |

---

## Bugs critiques à corriger en priorité

### BUG-01 — Validation serveur des victoires spéciales (Sécurité critique)

**Fichier :** `server/server.js` lignes 421–428  
**Impact :** Tout joueur peut réclamer CARRÉ, TCHIA, TROIS_SEPT, COULEUR, KORATTE sans les avoir.  
**Correction :** Stocker `p.hand` en mémoire serveur et vérifier les conditions lors de `claim-special-victory`.

### BUG-02 — `cardsPlayedInRound` non maintenu serveur (Règle Banque brisée)

**Fichier :** `server/server.js` — aucune ligne n'incrémente `table.cardsPlayedInRound`  
**Impact :** Un joueur peut banker en fin de partie après avoir vu tous les plis.  
**Correction :** Incrémenter `table.cardsPlayedInRound` dans le handler `card-played`, remettre à 0 dans `determineTrickWinner` à chaque nouveau pli.

### BUG-03 — Événement `clear-table` jamais émis (Affichage brisé)

**Fichier :** `server/server.js` — `clear-table` absent des émissions  
**Impact :** Les cartes des plis précédents s'accumulent visuellement entre chaque pli.  
**Correction :** Émettre `io.to(tableId).emit('clear-table', { winnerId: winnerObj.id })` après `determineTrickWinner` avant d'émettre `next-turn`.

### BUG-04 — Comparaison inter-passeurs défectueuse

**Fichier :** `server/server.js` lignes 346–363  
**Impact :** Si plusieurs joueurs passent, le premier dans la liste gagne toujours si leurs cartes sont de couleurs différentes, ou si aucun pli n'a été joué.  
**Correction :** Revoir la logique de comparaison pour inclure une règle claire sur la priorité des passeurs (meilleure carte toutes couleurs ? ou couleur de la dernière carte jouée ?).

### BUG-05 — Commission 5 % non prélevée

**Fichier :** `server/server.js` ligne 387  
**Impact :** Le Wali ne perçoit aucune commission. Pertes économiques à chaque partie.  
**Correction :** Dans `handleGameOver`, calculer `commission = pot * club.commission_rate`, créditer le Wali, créditer `pot - commission` au gagnant, insérer dans `commissions`.

### BUG-06 — Statut `suspended` non vérifié à la connexion

**Fichier :** `server/controllers/authController.js` ligne 109  
**Impact :** Un compte suspendu peut se connecter et jouer normalement.  
**Correction :** Ajouter après la récupération de l'utilisateur :
```js
if (user.status !== 'active') {
    return res.status(403).json({ msg: "Compte suspendu ou inactif." });
}
```

### BUG-07 — Bouton de triche en production

**Fichier :** `client/game.js` lignes 143–152  
**Impact :** Présence d'un bouton de test visible par tous les joueurs en prod.  
**Correction :** Supprimer le bloc `cheatBtn` ou le conditionner à une variable d'environnement `NODE_ENV=development`.

---

## Score global

| Catégorie | Implémentées | Partielles | Absentes |
|---|---|---|---|
| **Règles de jeu** (1–11) | 3 | 7 | 1 |
| **Économie** (12–13) | 0 | 0 | 2 |
| **Sécurité / Admin** (14–15) | 0 | 0 | 2 |
| **TOTAL** | **3 / 15** | **7 / 15** | **5 / 15** |

**Taux de couverture fonctionnelle :** 20 % implémentées, 47 % partielles, 33 % absentes.

> Le moteur de jeu de base (distribution, tours, plis simples, gestion Banque) est opérationnel pour un scénario sans victoire spéciale. Les règles avancées, la sécurité contre la triche, et l'économie du Wali nécessitent tous des développements avant mise en production.
