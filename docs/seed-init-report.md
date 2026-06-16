# FAP FAP — Rapport d'initialisation et tests

**Date :** 2026-06-16  
**Environnement :** Neon PostgreSQL 18.4 (eu-west-2) + Node.js 22 / Express 5 / Socket.IO 4  
**Base avant seed :** 0 lignes dans toutes les tables

---

## 1. Vérification de la base (avant seed)

| Table | Lignes avant | Lignes après |
|---|---|---|
| users | 0 | 8 |
| clubs | 0 | 2 |
| game_sessions | 0 | 1 |
| game_players | 0 | 4 |
| transactions | 0 | 11 |
| recharge_requests | 0 | 1 |
| audit_logs | 0 | 0 |

---

## 2. Données insérées par le seed

### Utilisateurs

| id | Username | Rôle | Wallet final | Club |
|---|---|---|---|---|
| 1 | Wali_FAP | superadmin | 1 000 000 FCFA | — |
| 2 | Katika_Issa | katika | 44 500 FCFA | Club Alpha |
| 3 | Joueur_Moussa | player | 17 000 FCFA | Club Alpha |
| 4 | Joueur_Fatou | player | 7 500 FCFA | Club Alpha |
| 5 | Joueur_Kofi | player | 4 500 FCFA | Club Alpha |
| 6 | Joueur_Awa | player | 2 500 FCFA | Club Alpha |

### Clubs

| id | Nom | Katika | Mise défaut | Commission |
|---|---|---|---|---|
| 1 | Club Alpha | Katika_Issa (id=2) | 500 FCFA | 5% |

### Transactions seed (11 au total après tests)

| id | Utilisateur | Type | Montant | Avant | Après |
|---|---|---|---|---|---|
| 1 | Joueur_Moussa | recharge | +10 000 | 0 | 10 000 |
| 2 | Joueur_Fatou | recharge | +8 000 | 0 | 8 000 |
| 3 | Joueur_Kofi | recharge | +5 000 | 0 | 5 000 |
| 4 | Joueur_Awa | recharge | +3 000 | 0 | 3 000 |
| 5 | Joueur_Moussa | mise | −500 | 10 000 | 9 500 |
| 6 | Joueur_Fatou | mise | −500 | 8 000 | 7 500 |
| 7 | Joueur_Kofi | mise | −500 | 5 000 | 4 500 |
| 8 | Joueur_Awa | mise | −500 | 3 000 | 2 500 |
| 9 | Joueur_Moussa | gain | +2 000 | 9 500 | 11 500 |
| 10 | Joueur_Moussa | transfert (Katika→Moussa) | +5 000 | 11 500 | 16 500 |
| 11 | Joueur_Moussa | transfert (test API) | +500 | 16 500 | 17 000 |

---

## 3. Résultats des tests

### Tests REST API

| # | Test | Endpoint | Résultat |
|---|---|---|---|
| 1 | Connexion Wali | `POST /api/auth/login` | ✅ Token JWT, role=superadmin, wallet=1 000 000 |
| 2 | Connexion Katika | `POST /api/auth/login` | ✅ Token JWT, role=katika, club_id=1 |
| 3 | Connexion Joueur | `POST /api/auth/login` | ✅ Token JWT, role=player, wallet=16 500 |
| 4 | Mauvais mot de passe | `POST /api/auth/login` | ✅ 400 — "Identifiants incorrects." |
| 5 | Solde wallet | `GET /api/money/balance` | ✅ `{"wallet":16500}` |
| 6 | Liste joueurs club | `GET /api/money/club-players/1` | ✅ 4 joueurs listés avec wallets |
| 7 | Liste Katikas | `GET /api/money/all-katikas` | ✅ Katika_Issa + Club Alpha |
| 8 | Inscription joueur | `POST /api/auth/register-player` | ✅ "Joueur Joueur_Test enregistré avec succès !" |
| 9 | Transfert argent | `POST /api/money/transfer` | ✅ +500 FCFA → Moussa = 17 000 |
| 10 | Solde insuffisant | `POST /api/money/transfer` | ✅ 400 — "Solde insuffisant..." |
| 11 | Demande recharge | `POST /api/money/recharge` | ✅ "Demande reçue. En attente..." |
| 12 | Doublon téléphone | `POST /api/auth/register-player` | ✅ 400 — "Ce numéro est déjà utilisé..." |
| 13 | Création Katika+Club | `POST /api/auth/register-katika` | ✅ Katika_Test + Club Beta créés (id=8, clubId=2) |

### Test Socket.IO

| Étape | Résultat |
|---|---|
| Connexion WebSocket | ✅ Socket ID attribué |
| Émission `join-table` (club_id=1, username=Joueur_Moussa) | ✅ Envoyé |
| Réception `wallet-update` | ✅ balance = 17 000 FCFA (depuis Neon) |
| Réception `player-list-update` | ✅ Joueur_Moussa(17000) dans la liste |

---

## 4. Cohérence des données vérifiée

- `balance_before` + `amount` = `balance_after` pour toutes les transactions ✅
- `wallet` dans `users` = `balance_after` de la dernière transaction ✅
- `club_id` dans `users` référence un club existant ✅
- `katika_id` dans `clubs` référence un user de rôle `katika` ✅
- Contrainte `CHECK (wallet >= 0)` respectée — aucune tentative invalide ✅

---

## 5. Cas edge testés

| Cas | Comportement attendu | Résultat |
|---|---|---|
| Login avec mauvais mot de passe | 400 "Identifiants incorrects." | ✅ |
| Inscription avec téléphone déjà pris | 400 "Ce numéro est déjà utilisé..." | ✅ |
| Transfert > solde disponible | 400 "Solde insuffisant..." | ✅ |
| Wali = superadmin, son wallet n'est pas débité | Transfert sans déduction | ✅ |

---

## 6. Fichiers créés

| Fichier | Description |
|---|---|
| `docs/seed-data.sql` | Script SQL transactionnel — insère tous les comptes de test |
| `docs/test-accounts.md` | Cheatsheet des identifiants de test |
| `docs/seed-init-report.md` | Ce rapport |

---

## 7. Comptes de test (résumé)

```
Wali_FAP       | 0600000001 | Wali2026!    | superadmin | 1 000 000 FCFA
Katika_Issa    | 0600000002 | Katika2026!  | katika     |    44 500 FCFA
Joueur_Moussa  | 0600000003 | Joueur2026!  | player     |    17 000 FCFA
Joueur_Fatou   | 0600000004 | Joueur2026!  | player     |     7 500 FCFA
Joueur_Kofi    | 0600000005 | Joueur2026!  | player     |     4 500 FCFA
Joueur_Awa     | 0600000006 | Joueur2026!  | player     |     2 500 FCFA
```

---

## 8. Prochaines étapes suggérées

- [ ] Middleware d'autorisation par rôle (actuellement `auth` vérifie le JWT mais pas le rôle sur chaque route)
- [ ] Implémenter la validation des demandes de recharge (endpoint `/recharge` est encore un stub)
- [ ] Enregistrement des `game_sessions` et `game_players` depuis Socket.IO (actuellement seulement les transactions sont enregistrées)
- [ ] Commissions Wali automatiques à la fin de chaque partie
- [ ] Interface admin pour consulter l'historique des transactions
