# FAP FAP 2.0 — Architecture : Entrée Libre + Centre de Notifications
**Date :** 2026-06-17  
**Portée :** Sprint 6 & Sprint 7  
**Base :** v1.0.0-rc1 (35/35 tests ✅) + Migration 002 Salon  
**Principe directeur :** Zéro friction à l'entrée — tout visiteur devient observateur sans compte

---

## Table des matières

1. [Nouvelle architecture — Vue d'ensemble](#1-nouvelle-architecture--vue-densemble)
2. [Schéma PostgreSQL](#2-schéma-postgresql)
3. [Impact backend](#3-impact-backend)
4. [Impact frontend](#4-impact-frontend)
5. [Nouveaux endpoints REST](#5-nouveaux-endpoints-rest)
6. [Nouveaux événements Socket.IO](#6-nouveaux-événements-socketio)
7. [Estimation de développement](#7-estimation-de-développement)
8. [Plan Sprint 6](#8-plan-sprint-6)
9. [Plan Sprint 7](#9-plan-sprint-7)
10. [Risques et recommandations](#10-risques-et-recommandations)

---

## 1. Nouvelle Architecture — Vue d'ensemble

### 1.1 Ce qui disparaît

| Supprimé | Raison |
|---|---|
| Modale "Jouer / Observer" à l'arrivée | Friction inutile — décision prématurée |
| Mode choix "libre / spectateur" | Observateur = état par défaut universel |

### 1.2 Parcours visiteur → joueur actif

```
┌─────────────────────────────────────────────────────────────┐
│  VISITEUR ANONYME                                           │
│  Accès via lien unique (/salon.html ou /salon.html?invite=X)│
└──────────────────────────┬──────────────────────────────────┘
                           │ Socket.IO connect — pas de JWT requis
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  SALON — MODE OBSERVATEUR (automatique)                     │
│  • Toutes les tables visibles                               │
│  • État en temps réel (joueurs assis, statut, mise)         │
│  • Clic sur une table → vue spectateur de la partie         │
│  • Carte en cours, liste joueurs, pot — lecture seule       │
│  • Pas de JWT, pas de compte                                │
└──────────────────────────┬──────────────────────────────────┘
                           │ Clic "Je veux jouer"
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  MODALE INSCRIPTION                                         │
│  • Téléphone (identifiant principal)                        │
│  • Nom complet                                              │
│  • Sobriquet (username visible en jeu)                      │
│  • Mot de passe                                             │
│  → POST /api/auth/register                                  │
│  → Compte créé, JWT émis, rôle = 'player'                   │
│  → Notification admin : "Nouvelle inscription"              │
└──────────────────────────┬──────────────────────────────────┘
                           │ Compte créé
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  MODALE DEMANDE DE JETONS                                   │
│  • Montant souhaité                                         │
│  • Note optionnelle (ex: numéro de transfert Orange Money)  │
│  → POST /api/money/request-tokens                           │
│  → recharge_requests créée (status = 'pending')             │
│  → Notification admin : "Demande de jetons"                 │
└──────────────────────────┬──────────────────────────────────┘
                           │ Attente validation Katika/Wali
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  JOUEUR ACTIF                                               │
│  • Wallet crédité par Katika via PUT /api/money/recharge/:id│
│  → Notification joueur : "Jetons validés — wallet X FCFA"   │
│  → Socket.IO : joueur peut maintenant s'asseoir             │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 Centre de notifications admin

```
┌──────────────────────────────────────────────────────────────┐
│  ADMIN / KATIKA — Dashboard                                  │
│                                              🔔  3           │
│                                          ┌──────────────┐   │
│                                          │ Notifications│   │
│  Tables du salon ─────────────────       │──────────────│   │
│                                          │ • Inscription│   │
│                                          │   Koffi Atta │   │
│                                          │   il y a 2min│   │
│                                          │──────────────│   │
│                                          │ • Demande    │   │
│                                          │   5 000 FCFA │   │
│                                          │   il y a 5min│   │
│                                          │──────────────│   │
│                                          │ • Recharge ✅│   │
│                                          │   Yao → 2000 │   │
│                                          │   il y a 1h  │   │
│                                          └──────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Schéma PostgreSQL

### 2.1 Migration 003 — notifications + recharge_requests

```sql
-- =============================================================================
-- FAP FAP 2.0 — Migration 003 : Notifications + Recharges
-- Dépend de : 001_neon_schema.sql, 002_salon.sql
-- =============================================================================

BEGIN;

-- ─── Types ────────────────────────────────────────────────────────────────────

CREATE TYPE notification_type AS ENUM (
    'nouvelle_inscription',   -- nouveau joueur inscrit
    'demande_jetons',         -- joueur demande des jetons
    'recharge_validee',       -- katika a validé une recharge
    'recharge_rejetee',       -- katika a rejeté une recharge
    'suspension',             -- compte suspendu
    'creation_table',         -- nouvelle table créée
    'fermeture_table'         -- table fermée
);

CREATE TYPE notification_audience AS ENUM (
    'wali',       -- Wali uniquement
    'katika',     -- Katika du club concerné
    'all_admin',  -- Wali + tous les Katika
    'player'      -- le joueur concerné
);

CREATE TYPE recharge_status AS ENUM (
    'pending',
    'approved',
    'rejected'
);

-- ─── Table notifications ──────────────────────────────────────────────────────

CREATE TABLE notifications (
    id              SERIAL                      PRIMARY KEY,
    type            notification_type           NOT NULL,
    audience        notification_audience       NOT NULL DEFAULT 'all_admin',
    title           VARCHAR(120)                NOT NULL,
    body            TEXT,
    club_id         INTEGER                     REFERENCES clubs(id) ON DELETE SET NULL,
    actor_id        INTEGER                     REFERENCES users(id) ON DELETE SET NULL,
    subject_id      INTEGER                     REFERENCES users(id) ON DELETE SET NULL,
    metadata        JSONB                       NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ                 NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  notifications IS 'Fil de notifications admin/katika/joueur — jamais supprimées, archivées';
COMMENT ON COLUMN notifications.actor_id   IS 'Qui a déclenché l action (joueur inscrit, admin qui valide...)';
COMMENT ON COLUMN notifications.subject_id IS 'Sur qui porte la notification (peut être égal à actor_id)';
COMMENT ON COLUMN notifications.club_id    IS 'NULL = concerne tous les clubs ; sinon club concerné';

-- ─── Table notification_reads (pivot many-to-many) ────────────────────────────

CREATE TABLE notification_reads (
    notification_id INTEGER     NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_id         INTEGER     NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
    read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (notification_id, user_id)
);

COMMENT ON TABLE notification_reads IS 'Suivi lecture par notification et par utilisateur admin';

-- ─── Table recharge_requests ──────────────────────────────────────────────────

CREATE TABLE recharge_requests (
    id              SERIAL              PRIMARY KEY,
    user_id         INTEGER             NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    club_id         INTEGER             REFERENCES clubs(id) ON DELETE SET NULL,
    amount          NUMERIC(10,2)       NOT NULL CHECK (amount > 0),
    status          recharge_status     NOT NULL DEFAULT 'pending',
    note            TEXT,
    processed_by    INTEGER             REFERENCES users(id) ON DELETE SET NULL,
    processed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  recharge_requests IS 'Demandes de jetons des joueurs — workflow pending→approved/rejected';
COMMENT ON COLUMN recharge_requests.note IS 'Numéro de transaction Orange Money, MTN, etc. fourni par le joueur';

CREATE TRIGGER trg_recharge_requests_updated_at
    BEFORE UPDATE ON recharge_requests
    FOR EACH ROW
    EXECUTE FUNCTION fn_set_updated_at();

-- ─── Index ────────────────────────────────────────────────────────────────────

CREATE INDEX idx_notif_audience     ON notifications(audience, created_at DESC);
CREATE INDEX idx_notif_club         ON notifications(club_id)   WHERE club_id IS NOT NULL;
CREATE INDEX idx_notif_subject      ON notifications(subject_id) WHERE subject_id IS NOT NULL;
CREATE INDEX idx_notif_type         ON notifications(type);

CREATE INDEX idx_notif_reads_user   ON notification_reads(user_id);

CREATE INDEX idx_recharge_user      ON recharge_requests(user_id);
CREATE INDEX idx_recharge_status    ON recharge_requests(status) WHERE status = 'pending';
CREATE INDEX idx_recharge_club      ON recharge_requests(club_id) WHERE club_id IS NOT NULL;

-- ─── Trigger : notification automatique sur INSERT recharge_requests ──────────

CREATE OR REPLACE FUNCTION fn_notify_recharge_request()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO notifications (type, audience, title, body, actor_id, subject_id, club_id, metadata)
    VALUES (
        'demande_jetons',
        'katika',
        'Demande de jetons',
        format('Joueur #%s demande %s FCFA', NEW.user_id, NEW.amount),
        NEW.user_id,
        NEW.user_id,
        NEW.club_id,
        jsonb_build_object('request_id', NEW.id, 'amount', NEW.amount)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recharge_request_notify
    AFTER INSERT ON recharge_requests
    FOR EACH ROW
    EXECUTE FUNCTION fn_notify_recharge_request();

-- ─── Vue : notifications non lues par admin ───────────────────────────────────

CREATE VIEW v_notifications_unread AS
SELECT
    n.id,
    n.type,
    n.audience,
    n.title,
    n.body,
    n.club_id,
    n.actor_id,
    n.subject_id,
    n.metadata,
    n.created_at,
    u_actor.username   AS actor_username,
    u_subject.username AS subject_username
FROM notifications n
LEFT JOIN users u_actor   ON n.actor_id   = u_actor.id
LEFT JOIN users u_subject ON n.subject_id = u_subject.id
WHERE NOT EXISTS (
    SELECT 1 FROM notification_reads nr
    WHERE nr.notification_id = n.id
    -- l'utilisateur est injecté côté applicatif : WHERE nr.user_id = $current_user_id
)
ORDER BY n.created_at DESC;

COMMIT;
```

### 2.2 Diagramme des relations (nouveaux objets)

```
users ──┬── recharge_requests ─── notifications
        │         └── clubs           │
        │                             │
        └── notification_reads ───────┘
                  (pivot)
```

### 2.3 Règles métier encodées en base

| Règle | Mécanisme |
|---|---|
| `amount > 0` | CHECK constraint |
| `status` valide | ENUM PostgreSQL |
| Trigger notification auto sur demande | `fn_notify_recharge_request` |
| `updated_at` auto | `fn_set_updated_at` (réutilisé) |

---

## 3. Impact Backend

### 3.1 Fichiers à créer

| Fichier | Contenu |
|---|---|
| `server/controllers/notificationController.js` | CRUD notifications, lecture |
| `server/controllers/rechargeController.js` | Remplacement du stub actuel |
| `server/routes/notificationRoutes.js` | Routes notifications |
| `server/routes/rechargeRoutes.js` | Routes recharge requests |
| `server/migrations/003_notifications.sql` | Schéma ci-dessus |

### 3.2 Fichiers à modifier

| Fichier | Modification |
|---|---|
| `server/server.js` | Socket.IO : diffusion `notification:new` aux admins connectés |
| `server/server.js` | Socket.IO : mode visiteur anonyme sans JWT |
| `server/controllers/authController.js` | `POST /register` : insérer notification `nouvelle_inscription` |
| `server/middleware/authMiddleware.js` | Permettre connexion Socket.IO sans token (visiteur) |
| `server/server.js` | Rejoindre salle `admin_room` si rôle admin/katika |

### 3.3 Modification auth Socket.IO — Mode visiteur

```js
// server.js — middleware Socket.IO actuel (bloque sans JWT)
// AVANT :
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Token manquant'));
    // ...
});

// APRÈS :
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        socket.data.visitor = true;   // mode observateur anonyme
        socket.data.user = null;
        return next();
    }
    // vérification JWT existante...
});
```

### 3.4 Service notification (helper partagé)

```js
// server/services/notificationService.js
async function createNotification(pool, { type, audience, title, body,
    clubId = null, actorId = null, subjectId = null, metadata = {} }) {
    const { rows } = await pool.query(
        `INSERT INTO notifications (type, audience, title, body,
            club_id, actor_id, subject_id, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [type, audience, title, body, clubId, actorId, subjectId, JSON.stringify(metadata)]
    );
    return rows[0];
}

module.exports = { createNotification };
```

Ce service est appelé à chaque événement métier, puis le résultat est diffusé via Socket.IO :

```js
// Après inscription :
const notif = await createNotification(pool, {
    type: 'nouvelle_inscription',
    audience: 'all_admin',
    title: 'Nouvelle inscription',
    body: `${username} vient de créer un compte`,
    actorId: newUser.id,
    subjectId: newUser.id
});
io.to('admin_room').emit('notification:new', notif);
io.to('admin_room').emit('notification:badge', { delta: +1 });
```

### 3.5 Diffusion aux admins — Salle Socket.IO

```js
// server.js — à l'authentification d'un admin/katika
socket.on('authenticate', (token) => {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.data.user = decoded;
    if (['wali', 'katika'].includes(decoded.role)) {
        socket.join('admin_room');
    }
    if (decoded.role === 'katika' && decoded.clubId) {
        socket.join(`club_room_${decoded.clubId}`);
    }
});
```

---

## 4. Impact Frontend

### 4.1 Pages à modifier

| Page | Changement |
|---|---|
| `client/salon.html` | Retirer garde d'accès JWT — charger en mode visiteur |
| `client/salon.html` | Bouton "Je veux jouer" → ouvre modale inscription |
| `client/salon.js` | Socket.IO sans token pour visiteurs |
| `client/dashboard-pro.html` | Ajouter cloche + panneau notifications |
| `client/dashboard-pro.js` | Écouter `notification:new`, `notification:badge` |

### 4.2 Composants à créer

| Composant | Description |
|---|---|
| `client/components/modal-register.html` | Modale inscription (téléphone, nom, sobriquet, mdp) |
| `client/components/modal-request-tokens.html` | Modale demande de jetons (montant, note) |
| `client/components/notification-panel.html` | Panneau glissant des notifications |

### 4.3 Logique visiteur dans salon.js

```js
// client/salon.js
const token = localStorage.getItem('token');
const socket = io(SERVER_URL, {
    auth: token ? { token } : {}  // connecte sans token si visiteur
});

socket.on('connect', () => {
    socket.emit('join-salon');  // reçoit v_salon_state sans restriction
});

// Bouton "Je veux jouer" — visible pour tous
document.getElementById('btn-play').addEventListener('click', () => {
    if (!token) {
        openModal('modal-register');
    } else {
        // joueur déjà connecté — vérifier wallet
        checkWalletAndSit();
    }
});
```

### 4.4 Flux inscription frontend

```
Saisie formulaire
    ↓
POST /api/auth/register  →  { token, user }
    ↓
localStorage.setItem('token', token)
    ↓
Fermer modale inscription
    ↓
Ouvrir modale "Demander des jetons"
    (avec pré-remplissage si club_id disponible)
    ↓
POST /api/money/request-tokens  →  { request_id }
    ↓
Message : "Votre demande est envoyée. Le Katika vous crédite bientôt."
    ↓
Socket reconnecté avec JWT — joueur peut observer
    (ne peut pas s'asseoir tant que wallet = 0)
```

### 4.5 Centre de notifications admin

```js
// client/dashboard-pro.js
let unreadCount = 0;

socket.on('notification:new', (notif) => {
    unreadCount++;
    updateBadge(unreadCount);
    prependNotification(notif);   // ajoute en tête du panneau
    playBellSound();              // optionnel
});

socket.on('notification:badge', ({ delta }) => {
    unreadCount = Math.max(0, unreadCount + delta);
    updateBadge(unreadCount);
});

function updateBadge(count) {
    const badge = document.getElementById('notif-badge');
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = count === 0 ? 'none' : 'inline-block';
}
```

---

## 5. Nouveaux Endpoints REST

### 5.1 Auth — Inscription publique

| Méthode | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | Aucune | Créer compte joueur (téléphone, nom, sobriquet, mdp) |

**Body :**
```json
{
  "phone": "0700123456",
  "full_name": "Kouassi Koffi",
  "username": "KoffiPlay",
  "password": "motdepasse123"
}
```

**Réponse 201 :**
```json
{
  "token": "eyJ...",
  "user": { "id": 42, "username": "KoffiPlay", "role": "player", "wallet": 0 }
}
```

### 5.2 Recharges

| Méthode | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/api/money/request-tokens` | Player JWT | Demande de jetons |
| `GET`  | `/api/money/requests` | Katika/Wali | Liste des demandes (filtrée par club) |
| `PUT`  | `/api/money/requests/:id/approve` | Katika/Wali | Approuver + créditer wallet |
| `PUT`  | `/api/money/requests/:id/reject` | Katika/Wali | Rejeter avec motif |

**POST /api/money/request-tokens — Body :**
```json
{ "amount": 5000, "note": "Transfer OM #123456" }
```

**PUT /api/money/requests/:id/approve — Body :**
```json
{ "amount": 5000 }  // peut différer de la demande initiale
```

### 5.3 Notifications

| Méthode | Route | Auth | Description |
|---|---|---|---|
| `GET`  | `/api/notifications` | Katika/Wali | Liste paginée (50 max) |
| `GET`  | `/api/notifications/unread-count` | Katika/Wali | Compteur non-lus |
| `PUT`  | `/api/notifications/:id/read` | Katika/Wali | Marquer comme lu |
| `PUT`  | `/api/notifications/read-all` | Katika/Wali | Tout marquer comme lu |

**GET /api/notifications — Réponse :**
```json
{
  "notifications": [
    {
      "id": 12,
      "type": "demande_jetons",
      "title": "Demande de jetons",
      "body": "Joueur #42 demande 5000 FCFA",
      "actor_username": "KoffiPlay",
      "metadata": { "request_id": 7, "amount": 5000 },
      "created_at": "2026-06-17T14:32:00Z",
      "is_read": false
    }
  ],
  "unread_count": 3,
  "total": 24
}
```

---

## 6. Nouveaux Événements Socket.IO

### 6.1 Serveur → Admin Room

| Événement | Déclencheur | Payload |
|---|---|---|
| `notification:new` | Tout événement métier | `{ id, type, title, body, actor_username, metadata, created_at }` |
| `notification:badge` | Après insertion notification | `{ delta: +1 }` |
| `notification:badge` | Après read-all | `{ delta: -N }` (N = count avant) |

### 6.2 Serveur → Joueur spécifique

| Événement | Déclencheur | Payload |
|---|---|---|
| `tokens:approved` | Katika approuve recharge | `{ new_balance: 5000, amount: 5000 }` |
| `tokens:rejected` | Katika rejette recharge | `{ reason: "Transfert non trouvé" }` |
| `account:suspended` | Admin suspend | `{ reason: "..." }` |

### 6.3 Serveur → Salon (tous)

| Événement | Déclencheur | Payload |
|---|---|---|
| `salon:table-created` | Admin crée une table | `{ table_id, name, min_bet, max_players }` |
| `salon:table-closed` | Admin ferme une table | `{ table_id }` |

### 6.4 Client → Serveur (visiteur)

| Événement | Condition | Effet |
|---|---|---|
| `join-salon` | Connexion (avec ou sans JWT) | Reçoit `salon:state` |
| `observe-table` | Sans JWT | Reçoit les événements de la table (lecture seule) |
| `join-table` | Nécessite JWT + wallet ≥ min_bet | S'asseoir à la table |

### 6.5 Client → Serveur (joueur connecté)

| Événement | Payload |
|---|---|
| `authenticate` | `{ token }` (reconnexion après inscription) |

---

## 7. Estimation de Développement

### 7.1 Récapitulatif par domaine

| Domaine | Tâches | Estimation |
|---|---|---|
| Migration 003 (SQL) | 1 fichier | 3h |
| Mode visiteur Socket.IO | `server.js` middleware | 2h |
| Inscription publique | controller + route + frontend | 5h |
| Workflow recharges | controller, routes, approbation | 6h |
| Service notifications | helper + triggers + diffusion | 4h |
| Endpoints notifications | controller + routes | 3h |
| Frontend : modale inscription | HTML + JS + validation | 4h |
| Frontend : modale jetons | HTML + JS + feedback | 3h |
| Frontend : cloche + panneau | HTML + JS + badge | 5h |
| Frontend : salon visiteur | retrait garde JWT, bouton play | 3h |
| Tests | unitaires + intégration | 5h |
| **Total** | | **~43h** |

### 7.2 Répartition Sprint 6 / Sprint 7

```
Sprint 6 (2 semaines = ~30h disponibles)
├── Migration 003           3h
├── Mode visiteur           2h
├── Inscription publique    5h
├── Workflow recharges      6h
├── Service notifications   4h
├── Endpoints notifications 3h
└── Tests sprint 6          4h
                        ───────
                            27h ✅

Sprint 7 (2 semaines = ~20h disponibles)
├── Frontend modales        7h
├── Frontend cloche/panneau 5h
├── Frontend salon visiteur 3h
└── Tests E2E + polish      5h
                        ───────
                            20h ✅
```

---

## 8. Plan Sprint 6

**Objectif :** Backend complet — visiteur + inscription + recharges + notifications

### Semaine 1 (Jours 1–5)

| Jour | Tâche | Livrable |
|---|---|---|
| J1 | Rédiger + exécuter `003_notifications.sql` | Tables créées sur Neon |
| J1 | Créer `server/services/notificationService.js` | Helper partagé |
| J2 | `authController.js` : ajouter `POST /api/auth/register` | Inscription sans rôle préalable |
| J2 | Trigger notification `nouvelle_inscription` dans register | Notification insérée + diffusée |
| J3 | `rechargeController.js` : remplacer stub complet | `POST request-tokens`, `GET requests` |
| J3 | `PUT requests/:id/approve` : crédit wallet + notification | Workflow complet côté Katika |
| J4 | `PUT requests/:id/reject` : notification rejet joueur | Workflow rejet |
| J4 | `notificationController.js` : GET list, unread-count, read | Endpoints notifications |
| J5 | Tests unitaires : inscription, recharge, notifications | 10+ nouveaux tests |

### Semaine 2 (Jours 6–10)

| Jour | Tâche | Livrable |
|---|---|---|
| J6 | Socket.IO middleware : mode visiteur sans JWT | `visitor: true` sur socket |
| J6 | Socket.IO : salle `admin_room` pour admins | Diffusion ciblée |
| J7 | `join-salon` sans JWT : envoyer `v_salon_state` | Visiteur voit le salon |
| J7 | `observe-table` sans JWT : recevoir events partie | Observateur anonyme |
| J8 | Socket.IO : `tokens:approved` / `tokens:rejected` → joueur | Notification directe joueur |
| J8 | Socket.IO : `salon:table-created` / `salon:table-closed` | Notif salon temps réel |
| J9 | Routes : wiring complet `notificationRoutes.js`, `rechargeRoutes.js` | Montées dans server.js |
| J10 | Tests d'intégration + revue sécurité Sprint 6 | Rapport sprint |

**Critères de validation Sprint 6 :**
- [ ] Un visiteur sans compte peut voir le salon via Socket.IO
- [ ] `POST /api/auth/register` crée un compte + insère notification
- [ ] `POST /api/money/request-tokens` crée une demande + notifie les admins
- [ ] `PUT .../approve` crédite le wallet + notifie le joueur
- [ ] `GET /api/notifications` retourne les notifications de l'admin connecté
- [ ] `npm test` → tous les tests passent

---

## 9. Plan Sprint 7

**Objectif :** Frontend complet — UX visiteur + modales + centre de notifications

### Semaine 3 (Jours 11–15)

| Jour | Tâche | Livrable |
|---|---|---|
| J11 | `salon.js` : Socket.IO sans token, join-salon auto | Salon visible sans compte |
| J11 | `salon.html` : retirer garde JWT, afficher bouton "Je veux jouer" | Accès libre |
| J12 | `modal-register` : HTML + CSS + validation phone/mdp | Modale fonctionnelle |
| J12 | `modal-register` : POST register + stocker token + reconnexion Socket | Flux complet |
| J13 | `modal-request-tokens` : HTML + CSS + formulaire montant/note | Modale jetons |
| J13 | Enchaînement automatique : après register → ouvrir modale jetons | Parcours fluide |
| J14 | `salon.js` : bloquer `join-table` si wallet = 0 + message guidant | UX claire |
| J15 | Tests manuels parcours complet visiteur → joueur actif | Validation UX |

### Semaine 4 (Jours 16–20)

| Jour | Tâche | Livrable |
|---|---|---|
| J16 | `dashboard-pro.html` : ajouter cloche + badge dans header | Structure HTML |
| J16 | `dashboard-pro.js` : charger unread-count au démarrage | Badge initial |
| J17 | `dashboard-pro.js` : `notification:new` → prepend + incrément badge | Temps réel |
| J17 | Panneau glissant : liste, timestamps relatifs, marquer lu au clic | UI complète |
| J18 | `dashboard-pro.js` : section "Demandes de jetons" (tableau pending) | Katika valide |
| J18 | Boutons Approuver/Rejeter dans le tableau recharges | Actions rapides |
| J19 | `player-view.html` : afficher statut demande de jetons (pending/approved) | Vue joueur |
| J19 | Écoute `tokens:approved` → mise à jour wallet affichée + message | Feedback immédiat |
| J20 | Tests E2E complets + audit accessibilité mobile | Rapport Sprint 7 final |

**Critères de validation Sprint 7 :**
- [ ] Visiteur arrive sur salon.html sans compte → voit toutes les tables
- [ ] Clic "Je veux jouer" → modale inscription s'ouvre
- [ ] Après inscription → modale jetons s'ouvre automatiquement
- [ ] Admin voit la cloche se mettre à jour en temps réel
- [ ] Admin peut approuver depuis le panneau → joueur notifié instantanément
- [ ] Joueur dont le wallet est 0 voit un message lui demandant d'attendre les jetons

---

## 10. Risques et Recommandations

### 10.1 Risques techniques

| # | Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|---|
| R-01 | PostgreSQL LISTEN/NOTIFY non fiable sur Neon avec pgBouncer | Haute | Moyen | **Ne pas utiliser LISTEN/NOTIFY.** Passer par Socket.IO applicatif (choix retenu dans cette architecture) |
| R-02 | Salon visible publiquement → scraping / abus | Moyenne | Faible | Rate-limit sur `join-salon`, pas de données sensibles exposées |
| R-03 | Inscription sans validation email/SMS → comptes factices | Haute | Moyen | Validation téléphone au niveau Katika avant d'approuver les jetons — frein naturel |
| R-04 | Mode visiteur Socket.IO augmente les connexions simultanées | Moyenne | Moyen | Surveiller pic de connexions ; déconnecter visiteurs inactifs après 30 min |
| R-05 | Notification broadcast à tous les admins si grand club | Faible | Faible | L'audience `katika` filtre par `club_id` — broadcast limité |
| R-06 | Course condition : double-approbation d'une même demande | Faible | Haute | `UPDATE ... WHERE status = 'pending' RETURNING id` — atomique en PostgreSQL |

### 10.2 Sécurité — Points d'attention

| Point | Recommandation |
|---|---|
| Inscription sans email | Valider format téléphone côté serveur (regex Côte d'Ivoire : `0[0-9]{9}`) |
| Demande jetons multiple | Limiter à 1 demande `pending` par joueur (CHECK ou contrainte applicative) |
| Visiteur voit les parties | N'exposer que les informations publiques : cartes masquées, pas de main visible |
| Admin panel exposé | Garder `requireRole(['wali','katika'])` sur **tous** les endpoints notification |
| Token JWT après inscription | Même durée de vie (24h) — l'accès au jeu est conditionné au wallet, pas au token |

### 10.3 Recommandations prioritaires

**Avant de commencer Sprint 6 :**

1. **Décider de l'identifiant joueur :** téléphone seul, ou téléphone + email optionnel. Le téléphone seul est suffisant pour le contexte local CI.

2. **Définir le montant minimum de demande :** éviter les micro-demandes (proposer min 500 FCFA).

3. **Clarifier le rôle Katika dans les notifications :** un Katika voit-il les inscriptions de tous les joueurs ou uniquement ceux de son club ? → Recommandation : uniquement son club (`club_id` filtre).

4. **Son de notification :** le son de cloche est optionnel mais fortement recommandé pour l'UX admin — simple fichier MP3/WAV local, aucune dépendance.

5. **Mobile-first pour les modales :** la majorité des joueurs en Côte d'Ivoire utilise un smartphone. Les modales doivent être testées sur petit écran avant tout.

### 10.4 Ce qui ne change pas

- Toute la logique de jeu existante (`server.js`) reste intacte
- Les 35 tests unitaires restent valides
- La migration 001 et 002 ne sont pas modifiées
- Le système auth JWT existant est réutilisé sans changement pour les joueurs connectés

---

## Annexe — Matrice de dépendances

```
003_notifications.sql
    ├── dépend de fn_set_updated_at (001_neon_schema.sql) ✅
    ├── dépend de clubs, users (001_neon_schema.sql) ✅
    └── indépendant de 002_salon.sql ✅

notificationService.js
    └── utilisé par : authController, rechargeController, server.js (Socket.IO)

rechargeController.js
    ├── remplace stub existant
    └── appelle notificationService.js

server.js (modifications)
    ├── middleware visiteur (petit changement)
    └── diffusion notification:new via io.to('admin_room')
```

---

*Document produit le 2026-06-17 — FAP FAP v2.0 Sprint 6+7*
