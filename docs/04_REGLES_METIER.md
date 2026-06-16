# 04 — Règles du Jeu FAP FAP & Conformité du Code

> Date : 2026-06-15

---

## 1. Reconstitution des règles du jeu (depuis le code)

### Deck (Jeu de cartes)

| Propriété | Valeur |
|-----------|--------|
| Nombre de cartes | 32 |
| Couleurs (suits) | ♠ spade, ♥ heart, ♣ club, ♦ diamond |
| Valeurs | 3, 4, 5, 6, 7, 8, 9, 10 |
| Pas de | As, Roi, Dame, Valet (pas de têtes) |

### Distribution
- Chaque joueur reçoit **5 cartes**
- Mise (stake) déduite du wallet au démarrage

### Joueurs
- Minimum : **2 joueurs** pour démarrer
- Maximum : **4 joueurs** par table

### Rôle du Dealer
- Le Dealer lance la partie (`start-game`)
- Après chaque partie, **le gagnant devient le nouveau Dealer**
- En cas de départ du Dealer, le slot suivant prend le rôle

### Ordre de jeu
- Le joueur à **gauche du Dealer** commence (`turnIndex = dealerIndex - 1`)
- Les tours progressent dans le sens **anti-horaire** (décrémentation d'index)

---

## 2. Actions disponibles

### NORMAL (jouer une carte)
- Le joueur actif joue 1 carte de sa main
- Les autres joueurs doivent **suivre la couleur** si possible
- La **carte la plus haute de la couleur menante** gagne le pli
- Le gagnant du pli mène le suivant

### PASS (se coucher)
- **Condition** : avoir exactement 2 cartes en main et être le joueur actif
- Le joueur verrouille ses 2 cartes (elles sont cachées)
- Le joueur ne joue plus de cartes mais **ses cartes sont révélées en fin de manche**
- Si sa meilleure carte est supérieure à la carte gagnante des autres, il **gagne la manche**

### BANQUE (se coucher définitivement)
- **Condition** : avoir joué moins de 2 cartes dans la manche (`cardsPlayedInRound < 2`)
- Le joueur sort de la manche immédiatement
- Si c'est le **dernier joueur restant**, la partie se termine

---

## 3. Victoires spéciales (déclarées côté client)

| Type | Condition déclarée | Multiplicateur |
|------|--------------------|----------------|
| **KORATTE** | 3♠ final + tous même couleur | pot × 2 |
| **CARRÉ** | 4 cartes identiques en valeur | pot (normal) |
| **TCHIA** | Total des cartes ≤ 21 | pot (normal) |
| **3 SEPT** | Trois 7 dans la main | pot (normal) |
| **COULEUR** | Toutes cartes même couleur (sans 3♠) | pot (normal) |

---

## 4. Analyse de conformité du code

### ✅ Règles correctement implémentées

| Règle | Code | Statut |
|-------|------|--------|
| Deck 32 cartes (3-10, 4 couleurs) | `server.js:184-186` | ✅ Correct |
| 5 cartes par joueur | `server.js:191` `deck.splice(0, 5)` | ✅ Correct |
| Minimum 2 joueurs pour démarrer | `server.js:141` `players.length < 2` | ✅ Correct |
| Maximum 4 joueurs | `server.js:83` `players.length < 4` | ✅ Correct |
| Débit de mise au démarrage | `server.js:155-161` | ✅ Correct |
| Crédit du pot au gagnant | `server.js:352` | ✅ Correct |
| Gagnant du pli = mène le suivant | `determineTrickWinner():294` | ✅ Correct |
| Gagnant = nouveau Dealer | `handleGameOver():365` | ✅ Correct |
| PASS : 2 cartes verrouillées | `player-pass handler:238-240` | ✅ Correct |
| BANQUE = sortie de manche | `fold-hand handler:218` | ✅ Correct |
| 1 seul restant après BANQUE = victoire | `server.js:223-224` | ✅ Correct |
| KORATTE = pot × 2 | `claim-special-victory:388` | ✅ Correct |

---

### ⚠️ Règles partiellement implémentées

| Règle | Problème | Code |
|-------|---------|------|
| **Suivi de couleur obligatoire** | Non vérifié côté serveur — le client choisit librement | `card-played` handler ne valide pas la couleur |
| **PASS : avoir exactement 2 cartes** | Vérifié (`hand.length === 2`) mais pas en tour de jeu normal | `server.js:236` |
| **BANQUE avant 2 cartes jouées** | `cardsPlayedInRound` est incrémenté nulle part (reste à 0 !) | Bug identifié |
| **Victoires spéciales** | Déclarées par le **client** uniquement — aucune vérification serveur | `claim-special-victory` |

---

### ❌ Règles non implémentées / Bugs

#### Bug 1 : `cardsPlayedInRound` jamais incrémenté
```javascript
// server.js:213 : condition BANQUE
if (!table || table.status !== 'PLAYING' || table.cardsPlayedInRound >= 2) return;
// Mais cardsPlayedInRound n'est JAMAIS incrémenté dans card-played !
// Résultat : on peut toujours banquer même au dernier pli
```

#### Bug 2 : Victoires spéciales non vérifiées serveur
```javascript
// client : game.js envoie claim-special-victory avec n'importe quel type
// server.js:383-390 : le serveur accepte sans vérification
socket.on('claim-special-victory', (data) => {
    const winner = table?.players.find(p => p.id === socket.id);
    if (!winner || !winner.isInHand) return;  // seule validation !
    let finalPot = data.type === 'KORATTE' ? table.pot * 2 : table.pot;
    handleGameOver(tableId, winner, finalPot, data.reason, data.club_id);
});
// EXPLOIT : n'importe quel joueur peut s'auto-déclarer gagnant
```

#### Bug 3 : Ordre de jeu inversé
```javascript
// server.js:175 : le premier à jouer est dealerIndex - 1
table.turnIndex = (table.dealerIndex - 1 + table.players.length) % table.players.length;
// server.js:276 : passTurn décrémente aussi
let nextIdx = (table.turnIndex - 1 + table.players.length) % table.players.length;
// L'ordre logique en jeu de cartes est généralement dealerIndex + 1 (sens horaire)
// À confirmer avec les règles officielles FAP FAP
```

#### Bug 4 : Déconnexion en cours de partie
```javascript
// Si un joueur se déconnecte pendant une partie PLAYING :
// - Sa mise est perdue (dans le pot)
// - La partie peut bloquer si c'était son tour
// - Aucun remboursement prévu
// handleDeparture() ne vérifie pas table.status === 'PLAYING'
```

#### Bug 5 : Données PASS incomplètes pour comparaison multi-passeurs
```javascript
// checkFinalReveal() : si plusieurs joueurs ont PASS
// La comparaison n'évalue pas correctement tous les passeurs entre eux
// Elle compare seulement le meilleur de chaque passeur avec finalCardVal
// Mais si finalCardVal est null (tous ont PASS), finalWinner = premier passeur uniquement
```

---

## 5. Recommandations de règles à ajouter

### Validation serveur des victoires spéciales
```javascript
// À implémenter dans server.js
function validateSpecialVictory(type, hand) {
    const values = hand.map(c => c.value);
    const suits = hand.map(c => c.suit);
    
    switch(type) {
        case 'CARRE':
            return values.some(v => values.filter(x => x === v).length >= 4);
        case 'COULEUR':
            return suits.every(s => s === suits[0]);
        case 'TCHIA':
            return values.reduce((a, b) => a + b, 0) <= 21;
        case 'TROIS_SEPT':
            return values.filter(v => v === 7).length >= 3;
        case 'KORATTE':
            return hand.some(c => c.value === 3 && c.suit === 'spade') && suits.every(s => s === suits[0]);
        default:
            return false;
    }
}
```

### Validation du suivi de couleur
```javascript
// Dans card-played handler
const leadingSuit = table.cardsOnTable[0]?.card.suit;
const playerHasSuit = currentPlayer.hand.some(c => c.suit === leadingSuit);
if (leadingSuit && playerHasSuit && data.card.suit !== leadingSuit) {
    socket.emit('invalid-move', { message: 'Tu dois jouer la couleur demandée' });
    return;
}
```
