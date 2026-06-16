# FAP FAP — Comptes de test

**Date de création :** 2026-06-16  
**Environnement :** Neon PostgreSQL (neondb, eu-west-2)  
**Base :** Vide au moment de l'exécution du seed

---

## Comptes créés

### Superadmin — Wali

| Champ | Valeur |
|---|---|
| **Username** | Wali_FAP |
| **Téléphone** | 0600000001 |
| **Mot de passe** | `Wali2026!` |
| **Rôle** | superadmin |
| **Wallet initial** | 1 000 000 FCFA |
| **Club** | — (aucun) |

> Le Wali peut transférer des fonds sans limite (son propre wallet n'est pas débité par l'app).

---

### Katika — Gestionnaire de club

| Champ | Valeur |
|---|---|
| **Username** | Katika_Issa |
| **Téléphone** | 0600000002 |
| **Mot de passe** | `Katika2026!` |
| **Rôle** | katika |
| **Wallet** | 50 000 → 45 000 FCFA (après transfert démo) |
| **Club** | Club Alpha (id=1) |

---

### Joueurs du Club Alpha

Mot de passe commun à tous les joueurs : **`Joueur2026!`**

| Username | Téléphone | Wallet initial | Wallet final |
|---|---|---|---|
| Joueur_Moussa | 0600000003 | 0 → 10 000 FCFA | **16 500 FCFA** |
| Joueur_Fatou | 0600000004 | 0 → 8 000 FCFA | **7 500 FCFA** |
| Joueur_Kofi | 0600000005 | 0 → 5 000 FCFA | **4 500 FCFA** |
| Joueur_Awa | 0600000006 | 0 → 3 000 FCFA | **2 500 FCFA** |

---

## Club créé

| Champ | Valeur |
|---|---|
| **Nom** | Club Alpha |
| **Katika** | Katika_Issa |
| **Mise par défaut** | 500 FCFA |
| **Max joueurs** | 4 |
| **Commission Wali** | 5% |
| **Statut** | open |

---

## Données de démonstration insérées

### Recharges initiales (Wali → Joueurs)

| Bénéficiaire | Montant | Solde avant | Solde après |
|---|---|---|---|
| Joueur_Moussa | +10 000 FCFA | 0 | 10 000 |
| Joueur_Fatou | +8 000 FCFA | 0 | 8 000 |
| Joueur_Kofi | +5 000 FCFA | 0 | 5 000 |
| Joueur_Awa | +3 000 FCFA | 0 | 3 000 |

### Partie de démonstration (mise 500 FCFA × 4 joueurs)

| Joueur | Événement | Montant | Solde avant | Solde après |
|---|---|---|---|---|
| Joueur_Moussa | mise | -500 | 10 000 | 9 500 |
| Joueur_Fatou | mise | -500 | 8 000 | 7 500 |
| Joueur_Kofi | mise | -500 | 5 000 | 4 500 |
| Joueur_Awa | mise | -500 | 3 000 | 2 500 |
| Joueur_Moussa | **gain (victoire normale)** | +2 000 | 9 500 | **11 500** |

### Transfert de démonstration

| Expéditeur | Bénéficiaire | Montant | Type |
|---|---|---|---|
| Katika_Issa | Joueur_Moussa | 5 000 FCFA | transfert |

### Demande de recharge en attente

| Demandeur | Cible | Montant | Statut |
|---|---|---|---|
| Joueur_Fatou | Joueur_Fatou | 5 000 FCFA | pending |

---

## Connexion rapide (curl)

```bash
# Login Wali
curl -s -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"0600000001","password":"Wali2026!"}'

# Login Katika
curl -s -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"0600000002","password":"Katika2026!"}'

# Login Joueur
curl -s -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"0600000003","password":"Joueur2026!"}'
```

---

## Identifiants résumés (cheatsheet)

```
Wali_FAP       | 0600000001 | Wali2026!    | superadmin | 1 000 000 FCFA
Katika_Issa    | 0600000002 | Katika2026!  | katika     |    45 000 FCFA
Joueur_Moussa  | 0600000003 | Joueur2026!  | player     |    16 500 FCFA
Joueur_Fatou   | 0600000004 | Joueur2026!  | player     |     7 500 FCFA
Joueur_Kofi    | 0600000005 | Joueur2026!  | player     |     4 500 FCFA
Joueur_Awa     | 0600000006 | Joueur2026!  | player     |     2 500 FCFA
```
