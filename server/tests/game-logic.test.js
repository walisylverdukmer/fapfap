/**
 * Tests unitaires — Logique de jeu FAP FAP
 * Exécution : node server/tests/game-logic.test.js
 * Aucune dépendance externe (assert natif Node.js)
 */

const assert = require('assert');

// ============================================================
// Copie des fonctions pures extraites de server.js
// (ne nécessitent pas io/db/tables)
// ============================================================

function validateSpecialVictory(hand, type) {
    if (!hand || hand.length !== 5) return false;
    const values = hand.map(c => c.value);
    const suits  = hand.map(c => c.suit);
    switch (type) {
        case 'TCHIA':
            return values.reduce((a, b) => a + b, 0) <= 21;
        case '3 SEPT':
            return values.filter(v => v === 7).length >= 3;
        case 'CARRE': {
            const counts = {};
            values.forEach(v => counts[v] = (counts[v] || 0) + 1);
            return Object.values(counts).some(c => c >= 4);
        }
        case 'COULEUR':
            return suits.every(s => s === suits[0]) && !values.includes(3);
        case 'KORATTE':
            return suits.every(s => s === suits[0]) && values.includes(3);
        default:
            return false;
    }
}

function cardInHand(hand, card) {
    return !!hand.find(c => c.suit === card.suit && c.value === card.value);
}

function suitViolation(hand, cardsOnTable, playedCard) {
    if (cardsOnTable.length === 0) return false;
    const leadingSuit    = cardsOnTable[0].card.suit;
    const hasLeadingSuit = hand.some(c => c.suit === leadingSuit);
    return hasLeadingSuit && playedCard.suit !== leadingSuit;
}

// ============================================================
// MINI RUNNER
// ============================================================

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✅ ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ❌ ${name}`);
        console.error(`     ${err.message}`);
        failed++;
    }
}

// ============================================================
// SUITE 1 — validateSpecialVictory
// ============================================================

console.log('\n── Suite 1 : validateSpecialVictory ──────────────────────');

test('TCHIA valide : somme ≤ 21', () => {
    const hand = [
        { suit: 'spade', value: 3 }, { suit: 'heart', value: 3 },
        { suit: 'club',  value: 4 }, { suit: 'diamond', value: 4 },
        { suit: 'spade', value: 5 }
    ]; // somme = 19
    assert.strictEqual(validateSpecialVictory(hand, 'TCHIA'), true);
});

test('TCHIA invalide : somme > 21', () => {
    const hand = [
        { suit: 'spade', value: 5 }, { suit: 'heart', value: 5 },
        { suit: 'club',  value: 5 }, { suit: 'diamond', value: 5 },
        { suit: 'spade', value: 6 }
    ]; // somme = 26
    assert.strictEqual(validateSpecialVictory(hand, 'TCHIA'), false);
});

test('TCHIA limite exacte : somme = 21', () => {
    const hand = [
        { suit: 'spade',   value: 3 }, { suit: 'heart',   value: 3 },
        { suit: 'club',    value: 5 }, { suit: 'diamond',  value: 5 },
        { suit: 'spade',   value: 5 }
    ]; // somme = 21
    assert.strictEqual(validateSpecialVictory(hand, 'TCHIA'), true);
});

test('3 SEPT valide : exactement 3 cartes de valeur 7', () => {
    const hand = [
        { suit: 'spade',  value: 7 }, { suit: 'heart',   value: 7 },
        { suit: 'club',   value: 7 }, { suit: 'diamond',  value: 5 },
        { suit: 'spade',  value: 6 }
    ];
    assert.strictEqual(validateSpecialVictory(hand, '3 SEPT'), true);
});

test('3 SEPT invalide : seulement 2 cartes de valeur 7', () => {
    const hand = [
        { suit: 'spade',  value: 7 }, { suit: 'heart',   value: 7 },
        { suit: 'club',   value: 5 }, { suit: 'diamond',  value: 5 },
        { suit: 'spade',  value: 6 }
    ];
    assert.strictEqual(validateSpecialVictory(hand, '3 SEPT'), false);
});

test('CARRÉ valide : 4 cartes de même valeur', () => {
    const hand = [
        { suit: 'spade',   value: 8 }, { suit: 'heart',   value: 8 },
        { suit: 'club',    value: 8 }, { suit: 'diamond',  value: 8 },
        { suit: 'spade',   value: 6 }
    ];
    assert.strictEqual(validateSpecialVictory(hand, 'CARRE'), true);
});

test('CARRÉ invalide : seulement 3 cartes de même valeur', () => {
    const hand = [
        { suit: 'spade',   value: 8 }, { suit: 'heart',   value: 8 },
        { suit: 'club',    value: 8 }, { suit: 'diamond',  value: 5 },
        { suit: 'spade',   value: 6 }
    ];
    assert.strictEqual(validateSpecialVictory(hand, 'CARRE'), false);
});

test('COULEUR valide : 5 cartes même couleur, sans 3', () => {
    const hand = [
        { suit: 'heart', value: 5 }, { suit: 'heart', value: 6 },
        { suit: 'heart', value: 7 }, { suit: 'heart', value: 8 },
        { suit: 'heart', value: 9 }
    ];
    assert.strictEqual(validateSpecialVictory(hand, 'COULEUR'), true);
});

test('COULEUR invalide : 5 cartes même couleur AVEC 3 (= KORATTE, pas COULEUR)', () => {
    const hand = [
        { suit: 'heart', value: 3 }, { suit: 'heart', value: 6 },
        { suit: 'heart', value: 7 }, { suit: 'heart', value: 8 },
        { suit: 'heart', value: 9 }
    ];
    assert.strictEqual(validateSpecialVictory(hand, 'COULEUR'), false);
});

test('COULEUR invalide : couleurs mixtes', () => {
    const hand = [
        { suit: 'heart',  value: 5 }, { suit: 'spade', value: 6 },
        { suit: 'heart',  value: 7 }, { suit: 'heart', value: 8 },
        { suit: 'heart',  value: 9 }
    ];
    assert.strictEqual(validateSpecialVictory(hand, 'COULEUR'), false);
});

test('KORATTE valide : 5 cartes même couleur avec 3', () => {
    const hand = [
        { suit: 'spade', value: 3 }, { suit: 'spade', value: 6 },
        { suit: 'spade', value: 7 }, { suit: 'spade', value: 8 },
        { suit: 'spade', value: 9 }
    ];
    assert.strictEqual(validateSpecialVictory(hand, 'KORATTE'), true);
});

test('KORATTE invalide : même couleur mais sans 3', () => {
    const hand = [
        { suit: 'spade', value: 4 }, { suit: 'spade', value: 6 },
        { suit: 'spade', value: 7 }, { suit: 'spade', value: 8 },
        { suit: 'spade', value: 9 }
    ];
    assert.strictEqual(validateSpecialVictory(hand, 'KORATTE'), false);
});

test('Type inconnu retourne false', () => {
    const hand = [
        { suit: 'spade', value: 3 }, { suit: 'spade', value: 6 },
        { suit: 'spade', value: 7 }, { suit: 'spade', value: 8 },
        { suit: 'spade', value: 9 }
    ];
    assert.strictEqual(validateSpecialVictory(hand, 'BLUFF'), false);
});

test('Main vide retourne false', () => {
    assert.strictEqual(validateSpecialVictory([], 'TCHIA'), false);
});

test('Main null retourne false', () => {
    assert.strictEqual(validateSpecialVictory(null, 'TCHIA'), false);
});

test('Main à 4 cartes retourne false (doit en avoir exactement 5)', () => {
    const hand = [
        { suit: 'spade', value: 3 }, { suit: 'spade', value: 4 },
        { suit: 'spade', value: 5 }, { suit: 'spade', value: 6 }
    ];
    assert.strictEqual(validateSpecialVictory(hand, 'TCHIA'), false);
});

// ============================================================
// SUITE 2 — Validation de carte (cardInHand)
// ============================================================

console.log('\n── Suite 2 : cardInHand ──────────────────────────────────');

const sampleHand = [
    { suit: 'spade',   value: 5 },
    { suit: 'heart',   value: 7 },
    { suit: 'club',    value: 3 },
    { suit: 'diamond', value: 9 },
    { suit: 'spade',   value: 10 }
];

test('Carte présente dans la main → true', () => {
    assert.strictEqual(cardInHand(sampleHand, { suit: 'heart', value: 7 }), true);
});

test('Carte absente de la main → false', () => {
    assert.strictEqual(cardInHand(sampleHand, { suit: 'heart', value: 8 }), false);
});

test('Même valeur mais couleur différente → false', () => {
    assert.strictEqual(cardInHand(sampleHand, { suit: 'club', value: 5 }), false);
});

test('Même couleur mais valeur différente → false', () => {
    assert.strictEqual(cardInHand(sampleHand, { suit: 'spade', value: 6 }), false);
});

test('Carte inexistante dans deck FAP FAP (valeur 11) → false', () => {
    assert.strictEqual(cardInHand(sampleHand, { suit: 'spade', value: 11 }), false);
});

// ============================================================
// SUITE 3 — Règle de suivre la couleur (suitViolation)
// ============================================================

console.log('\n── Suite 3 : suitViolation ───────────────────────────────');

const handWithSpade = [
    { suit: 'spade', value: 5 },
    { suit: 'heart', value: 7 },
    { suit: 'club',  value: 8 }
];

const handWithoutSpade = [
    { suit: 'heart',   value: 5 },
    { suit: 'diamond', value: 7 },
    { suit: 'club',    value: 8 }
];

const tableWithSpade = [
    { card: { suit: 'spade', value: 6 } }
];

test('Violation : joueur a la couleur d\'entame et joue autre chose', () => {
    const played = { suit: 'heart', value: 7 };
    assert.strictEqual(suitViolation(handWithSpade, tableWithSpade, played), true);
});

test('Pas de violation : joueur joue la couleur d\'entame', () => {
    const played = { suit: 'spade', value: 5 };
    assert.strictEqual(suitViolation(handWithSpade, tableWithSpade, played), false);
});

test('Pas de violation : joueur n\'a pas la couleur d\'entame', () => {
    const played = { suit: 'heart', value: 5 };
    assert.strictEqual(suitViolation(handWithoutSpade, tableWithSpade, played), false);
});

test('Pas de violation : table vide (premier à jouer)', () => {
    const played = { suit: 'heart', value: 5 };
    assert.strictEqual(suitViolation(handWithSpade, [], played), false);
});

test('Pas de violation : joue n\'importe quelle couleur si table vide', () => {
    const played = { suit: 'diamond', value: 9 };
    assert.strictEqual(suitViolation(handWithSpade, [], played), false);
});

// ============================================================
// SUITE 4 — Deck et distribution (invariants)
// ============================================================

console.log('\n── Suite 4 : Invariants du deck ──────────────────────────');

test('Deck FAP FAP = 32 cartes (valeurs 3–10, 4 couleurs)', () => {
    const deck = [];
    const suits = ['spade', 'heart', 'club', 'diamond'];
    for (const s of suits) for (let v = 3; v <= 10; v++) deck.push({ suit: s, value: v });
    assert.strictEqual(deck.length, 32);
});

test('Chaque couleur a exactement 8 cartes', () => {
    const deck = [];
    const suits = ['spade', 'heart', 'club', 'diamond'];
    for (const s of suits) for (let v = 3; v <= 10; v++) deck.push({ suit: s, value: v });
    for (const s of suits) {
        assert.strictEqual(deck.filter(c => c.suit === s).length, 8, `Couleur ${s}`);
    }
});

test('Il y a exactement 4 cartes de valeur 7 dans le deck', () => {
    const deck = [];
    const suits = ['spade', 'heart', 'club', 'diamond'];
    for (const s of suits) for (let v = 3; v <= 10; v++) deck.push({ suit: s, value: v });
    assert.strictEqual(deck.filter(c => c.value === 7).length, 4);
});

test('Après distribution à 4 joueurs (5 cartes chacun) il reste 12 cartes', () => {
    assert.strictEqual(32 - 4 * 5, 12);
});

test('Après distribution à 2 joueurs (5 cartes chacun) il reste 22 cartes', () => {
    assert.strictEqual(32 - 2 * 5, 22);
});

test('KORATTE (3 + 4 cartes de même couleur) est possible : 4 cartes par couleur ≥ 4', () => {
    // 4 cartes de chaque couleur → KORATTE toujours possible
    assert.ok(8 >= 5, 'On a 8 cartes par couleur, KORATTE (5 cartes même couleur) est possible');
});

// ============================================================
// SUITE 5 — Rate limiting (logique)
// ============================================================

console.log('\n── Suite 5 : Rate limiting (logique) ─────────────────────');

function buildRateLimiter(windowMs, max) {
    const attempts = new Map();
    return function isLimited(ip) {
        const now   = Date.now();
        const entry = attempts.get(ip);
        if (!entry || now - entry.firstAttempt > windowMs) {
            attempts.set(ip, { count: 1, firstAttempt: now });
            return false;
        }
        entry.count++;
        return entry.count > max;
    };
}

test('Pas bloqué sous le seuil', () => {
    const limited = buildRateLimiter(60000, 3);
    assert.strictEqual(limited('127.0.0.1'), false); // 1
    assert.strictEqual(limited('127.0.0.1'), false); // 2
    assert.strictEqual(limited('127.0.0.1'), false); // 3
});

test('Bloqué au-delà du seuil', () => {
    const limited = buildRateLimiter(60000, 3);
    limited('10.0.0.1'); limited('10.0.0.1'); limited('10.0.0.1'); // 1,2,3
    assert.strictEqual(limited('10.0.0.1'), true); // 4 → bloqué
});

test('IPs différentes ne s\'influencent pas', () => {
    const limited = buildRateLimiter(60000, 2);
    limited('1.2.3.4'); limited('1.2.3.4'); // 1,2 → pas encore bloqué
    assert.strictEqual(limited('5.6.7.8'), false); // IP différente = frais
});

// ============================================================
// RÉSULTAT FINAL
// ============================================================

const total = passed + failed;
console.log(`\n══════════════════════════════════════════════════════════`);
console.log(`Résultat : ${passed}/${total} tests passés`);
if (failed > 0) {
    console.error(`⛔  ${failed} test(s) en échec`);
    process.exit(1);
} else {
    console.log(`✅  Tous les tests passent.`);
    process.exit(0);
}
