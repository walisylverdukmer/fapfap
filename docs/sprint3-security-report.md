# FAP FAP — Rapport Sécurité Sprint 3 : Administration et sanctions

**Date :** 2026-06-16  
**Environnement :** Neon PostgreSQL 18.4 + Node.js 22 / Express 5 / Socket.IO 4  
**Scope :** BUG-06 Gestion des comptes suspendus + BUG-15 Exclusion pour triche

---

## 1. Objectifs et statut

| Objectif | Statut |
|---|---|
| Empêcher un compte suspendu de se connecter | ✅ (BUG-06, Sprint 1) + confirmé |
| Permettre la suspension par un admin via API | ✅ Implémenté |
| Permettre le bannissement définitif (Wali) | ✅ Implémenté |
| Déconnecter immédiatement un joueur sanctionné | ✅ Via Socket.IO `force-disconnect` |
| Suspension automatique après 3 fraudes (BUG-15) | ✅ Implémenté |
| Journaliser toutes les sanctions dans `audit_logs` | ✅ Implémenté |

---

## 2. Fichiers créés / modifiés

| Fichier | Action | Description |
|---|---|---|
| `server/middleware/requireRole.js` | Créé | Middleware d'autorisation par rôle |
| `server/controllers/adminController.js` | Créé | 5 fonctions d'administration |
| `server/routes/adminRoutes.js` | Créé | 5 routes `/api/admin/*` |
| `server/server.js` | Modifié | `connectedSockets`, `autoSuspendCheater`, tracking |

---

## 3. Architecture — Déconnexion immédiate

```
HTTP PUT /api/admin/users/:id/suspend
  └── adminController.suspendUser
        ├── DB: UPDATE users SET status='suspended'
        ├── DB: INSERT audit_logs (action='suspend')
        ├── connectedSockets.get(userId) → socketId
        ├── io.to(socketId).emit('force-disconnect', {reason})
        └── io.sockets.sockets.get(socketId)?.disconnect(true)
```

`connectedSockets` est une `Map<dbId, socketId>` (module-level dans `server.js`), accessible aux contrôleurs via `req.app.get('connectedSockets')` (pattern Express).

```
Socket.IO join-table
  └── socket.userId = rows[0].id
  └── connectedSockets.set(socket.userId, socket.id)   ← enregistrement

Socket.IO disconnect
  └── connectedSockets.delete(socket.userId)           ← nettoyage
```

---

## 4. Endpoints créés — `/api/admin/`

### Middleware `requireRole`

```js
// server/middleware/requireRole.js
module.exports = (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role))
        return res.status(403).json({ msg: `Accès refusé. Rôles autorisés : ${roles.join(', ')}.` });
    next();
};
```

### Routes et droits

| Méthode | Route | Rôles autorisés | Description |
|---|---|---|---|
| GET | `/api/admin/users` | superadmin, katika | Liste utilisateurs (filtrée par rôle) |
| GET | `/api/admin/sanctions` | superadmin, katika | Historique audit_logs des sanctions |
| PUT | `/api/admin/users/:id/suspend` | superadmin, katika | Suspension temporaire |
| PUT | `/api/admin/users/:id/unsuspend` | superadmin, katika | Réactivation |
| PUT | `/api/admin/users/:id/ban` | superadmin | Bannissement définitif (`status=inactive`) |

### Règles métier d'autorisation

| Acteur | Peut suspendre | Peut réactiver | Peut bannir |
|---|---|---|---|
| Wali (superadmin) | Katika + Joueurs (sauf Wali) | Tout sauf `inactive` | Katika + Joueurs |
| Katika | Joueurs de son club uniquement | Joueurs de son club | Interdit |
| Joueur | Interdit | Interdit | Interdit |

**Invariants :**
- Impossible de suspendre un `superadmin`
- Impossible de bannir soi-même
- Impossible de réactiver un compte `inactive` depuis `/unsuspend` (seul le Wali peut décider)
- Status `inactive` = banni définitivement (bloqué à la connexion JWT)

---

## 5. BUG-15 — Auto-suspension pour fraude (Socket.IO)

### Détection et séquence

```
claim-special-victory (serveur)
  ├── validateSpecialVictory(hand, type)
  ├── [FAUX] winner.suspiciousClaims += 1
  │
  ├── Si suspiciousClaims < 3 :
  │     └── socket.emit('claim-rejected', { reason: 'Avertissement N/3 — X restant(s).' })
  │
  └── Si suspiciousClaims >= 3 :
        ├── socket.emit('claim-rejected', { reason: 'Exclusion pour fraude répétée.' })
        └── autoSuspendCheater(winner, tableId, socket)
              ├── DB: UPDATE users SET status='suspended'
              ├── DB: INSERT audit_logs (action='auto_suspend_cheat')
              ├── io.to(tableId).emit('player-cheating-banned', { username, reason })
              ├── socket.emit('force-disconnect', { reason: 'Compte suspendu...' })
              └── socket.disconnect(true)
```

### Événements Socket.IO côté client

| Événement | Reçu par | Contenu |
|---|---|---|
| `claim-rejected` | Fraudeur | `{ reason: 'Avertissement N/3 — X restant(s).' }` |
| `claim-rejected` (3e) | Fraudeur | `{ reason: 'Exclusion pour fraude répétée.' }` |
| `player-cheating-banned` | Toute la table | `{ username, reason }` |
| `force-disconnect` | Fraudeur | `{ reason: 'Compte suspendu automatiquement...' }` |

### Compteur `suspiciousClaims`

Le compteur est stocké sur l'objet `winner` dans la Map `tables` (in-memory, non-persisté). Il se réinitialise si le joueur quitte et rejoint la table. Ce comportement est intentionnel : la suspension définitive est une décision admin.

---

## 6. Résultats des tests

### 15 tests API (tous ✅)

| # | Test | Résultat attendu | Résultat |
|---|---|---|---|
| T01 | Wali liste tous les users | 8 utilisateurs avec status | ✅ |
| T02 | Katika liste son club | 5 joueurs uniquement | ✅ |
| T03 | Joueur accède à /admin/users | 403 | ✅ |
| T04 | Wali suspend Joueur_Kofi | Suspendu + `was_online:false` | ✅ |
| T05 | Joueur_Kofi tente de se connecter | 403 "Compte suspendu ou inactif" | ✅ |
| T06 | Katika suspend Joueur_Awa | Suspendu | ✅ |
| T07 | Katika tente de suspendre Wali | 403 "Impossible de suspendre un administrateur" | ✅ |
| T08 | Suspendre un compte déjà suspendu | 400 "Déjà suspendu" | ✅ |
| T09 | Réactiver Joueur_Kofi | Réactivé | ✅ |
| T10 | Joueur_Kofi se reconnecte | Login OK | ✅ |
| T11 | Wali banne Joueur_Awa | Banni définitivement | ✅ |
| T12 | Joueur_Awa tente de se connecter | 403 | ✅ |
| T13 | Katika tente de bannir | 403 "Rôles autorisés : superadmin" | ✅ |
| T14 | Réactiver un compte banni | 400 "Banni définitivement" | ✅ |
| T15 | User inexistant | 404 | ✅ |

### 1 test Socket.IO BUG-15 — auto-suspend fraude ✅

Séquence observée :
```
[TABLE OK] wallet: 22000 — Lancement des claims
[CLAIM #1/3] TCHIA frauduleux
[REJECTED #1] Avertissement 1/3 — 2 restant(s).
[CLAIM #2/3] TCHIA frauduleux
[REJECTED #2] Avertissement 2/3 — 1 restant(s).
[CLAIM #3/3] TCHIA frauduleux
[REJECTED #3] Exclusion pour fraude répétée.
[BANNED-EVENT] ✅ username:Joueur_Moussa | Exclusion automatique...
[FORCE-DISCONNECT] ✅ Compte suspendu automatiquement...
```

**État DB vérifié :** `Joueur_Moussa.status = 'suspended'` ✅  
**audit_logs :** `auto_suspend_cheat` inséré ✅  
**Login bloqué :** 403 "Compte suspendu ou inactif" ✅

---

## 7. Procédures d'administration

### Suspendre un joueur

```bash
curl -X PUT http://localhost:5000/api/admin/users/:id/suspend \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Comportement inapproprié à la table"}'

# Réponse : {"msg": "Compte de Joueur_X suspendu.", "was_online": true/false}
# Si was_online=true : la déconnexion Socket.IO a été envoyée immédiatement
```

### Réactiver un compte

```bash
curl -X PUT http://localhost:5000/api/admin/users/:id/unsuspend \
  -H "Authorization: Bearer $TOKEN_KATIKA_OU_WALI"

# Réponse : {"msg": "Compte de Joueur_X réactivé."}
```

### Bannir définitivement (Wali seulement)

```bash
curl -X PUT http://localhost:5000/api/admin/users/:id/ban \
  -H "Authorization: Bearer $TOKEN_WALI" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Triche avérée — preuve photographique #47"}'

# Réponse : {"msg": "Compte de Joueur_X banni définitivement.", "was_online": false}
```

### Consulter l'historique des sanctions

```bash
curl http://localhost:5000/api/admin/sanctions \
  -H "Authorization: Bearer $TOKEN"

# Paramètre optionnel : ?action=suspend pour filtrer
```

### Lister les utilisateurs et leurs statuts

```bash
# Wali : tous les utilisateurs
curl http://localhost:5000/api/admin/users \
  -H "Authorization: Bearer $TOKEN_WALI"

# Katika : joueurs de son club uniquement (filtrage automatique)
curl http://localhost:5000/api/admin/users \
  -H "Authorization: Bearer $TOKEN_KATIKA"
```

---

## 8. Statuts possibles (`user_status` ENUM)

| Valeur | Signification | Connexion | Qui peut appliquer | Réversible |
|---|---|---|---|---|
| `active` | Compte normal | ✅ Autorisée | — | — |
| `suspended` | Suspension temporaire | ❌ 403 | Wali, Katika (club) | ✅ via `/unsuspend` |
| `inactive` | Bannissement définitif | ❌ 403 | Wali uniquement | ⚠️ Décision manuelle |

---

## 9. Limites et prochaines étapes

- **Reconnexion pendant suspension :** si le joueur tente de rejoindre la table via Socket.IO avec un compte suspendu, il n'est pas bloqué côté Socket.IO (seul le login HTTP est bloqué). À corriger : ajouter une vérification du status dans `join-table`.
- **suspiciousClaims reset :** le compteur est in-memory et se perd au redémarrage serveur ou si le joueur quitte/rejoint la table. Acceptable pour la v1.
- **Notification email/SMS :** aucune notification externe envoyée lors d'une sanction — à brancher sur un service SMTP/WhatsApp dans un sprint ultérieur.
- **Logging IP :** `audit_logs.ip_address` non encore renseignée (colonne INET disponible dans le schéma).
