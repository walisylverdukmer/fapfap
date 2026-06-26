if (!AuthGuard.require(['player', 'katika', 'superadmin'])) throw 0;
const socket = io(BACKEND_URL);

// --- INITIALISATION UTILISATEUR ---
const user = AuthGuard.getUser();
const salonTableId  = parseInt(localStorage.getItem('salon_table_id')) || null;
const isObserver    = localStorage.getItem('salon_observer') === '1';
const tableCurrency = localStorage.getItem('table_currency') || 'FCFA';
const tableType     = localStorage.getItem('table_type')     || 'real';
const isAcademy     = tableType === 'academy';

// --- VARIABLES GLOBALES ---
let myHand = [];
let isMyTurn = false;
let playerMap = {}; 
let hasFolded = false; 
let isPassing = false; 
let cardsPlayedInRound = 0; 
let currentDealerId = null; 

// --- 1. CONNEXION INITIALE ---
if (salonTableId && isObserver) {
    console.log("Mode observateur — Table ID:", salonTableId);
    socket.emit('observe-table', {
        salon_table_id: salonTableId,
        username: user.username
    });
} else if (salonTableId) {
    console.log("Mode salon — Table ID:", salonTableId);
    socket.emit('sit-at-table', {
        salon_table_id: salonTableId,
        username: user.username,
        stake: user.stake
    });
} else {
    console.log("Connexion au club ID:", user.club_id);
    socket.emit('join-table', {
        club_id: user.club_id,
        username: user.username,
        stake: user.stake
    });
}

// Mode observateur : bannière + verrouillage complet de l'UI
if (isObserver) {
    document.addEventListener('DOMContentLoaded', () => {
        // Bannière persistante
        const banner = document.createElement('div');
        banner.id = 'observer-banner';
        banner.style.cssText = [
            'position:fixed', 'top:62px', 'left:0', 'right:0',
            'background:rgba(26,26,110,0.92)', 'color:#aad4ff',
            'text-align:center', 'padding:5px 10px', 'font-size:0.82rem',
            'z-index:1050', 'border-bottom:1px solid #3a3a8e',
            'pointer-events:none'
        ].join(';');
        banner.innerText = 'MODE OBSERVATEUR — Vous regardez sans jouer';
        document.body.appendChild(banner);

        // Masquer les éléments réservés aux joueurs
        ['distribBtn', 'special-actions', 'my-hand', 'my-wallet-amount'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        // Le bouton "SE LEVER" devient "QUITTER" pour l'observateur
        const btnLeave = document.getElementById('btn-leave-table');
        if (btnLeave) {
            btnLeave.innerText  = 'QUITTER';
            btnLeave.onclick    = () => goToSalon();
        }

        // Masquer le chat input (observateur peut lire mais pas écrire)
        const chatInput = document.querySelector('.chat-input-area');
        if (chatInput) chatInput.style.display = 'none';
    });
}

// --- GESTION DU SOLDE (WALLET) ---
socket.on('wallet-update', (data) => {
    console.log("💰 Update Wallet reçue :", data.balance);
    const walletEl = document.getElementById('my-wallet-amount');
    
    // Mise à jour visuelle avec effet flash vert
    if(walletEl) {
        walletEl.innerText = data.balance + " " + tableCurrency;
        walletEl.style.color = "#27ae60";
        setTimeout(() => { walletEl.style.color = "white"; }, 1000);
    }

    // Alerte si solde trop bas
    if (data.balance < user.stake) {
        showAnnouncement(`⚠️ SOLDE INSUFFISANT (${data.balance} ${tableCurrency}) !`, 5000);
    }
});

// --- 2. GESTION DU CHAT ---
function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (message !== "") {
        socket.emit('send-chat', {
            club_id: user.club_id,
            salon_table_id: salonTableId,
            username: user.username,
            message: message
        });
        input.value = "";
    }
}

document.getElementById('chat-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
});

socket.on('receive-chat', (data) => {
    const chatBox = document.getElementById('chat-messages');
    if(!chatBox) return;
    const msgDiv = document.createElement('div');
    msgDiv.style.marginBottom = "8px";
    msgDiv.innerHTML = `<small style="color:#888">${data.time}</small> <strong>${data.username}:</strong> ${data.message}`;
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
});

// --- 3. GESTION DE L'HISTORIQUE ---
socket.on('history-update', (data) => {
    const historyBox = document.getElementById('history-list');
    if(!historyBox) return;
    const logDiv = document.createElement('div');
    logDiv.style.padding = "5px 0";
    logDiv.style.borderBottom = "1px solid #eee";
    logDiv.style.fontSize = "0.85rem";
    
    let color = "#333";
    if(data.type === 'victory') color = "#27ae60"; 
    if(data.type === 'warning') color = "#c0392b"; 
    if(data.type === 'system') color = "#f39c12";

    logDiv.innerHTML = `<span style="color:#999">[${data.time}]</span> <span style="color:${color}">${data.message}</span>`;
    historyBox.prepend(logDiv); 
});

// --- 4. MISE À JOUR INTERFACE JOUEURS & DEALER ---
socket.on('player-list-update', (players) => {
    console.log("👥 Liste joueurs mise à jour :", players.length);

    playerMap = {};
    // BUG-H fix : calculé avant le reset pour savoir si on est déjà assis
    const alreadySeated = players.some(p => p.id === socket.id);

    // Etape A : Reset complet des slots pour éviter les doublons
    for(let i=1; i<=4; i++) {
        const isMeSlot = (i === 1);
        const nameEl = document.getElementById(isMeSlot ? 'my-name' : `n-${i}`);
        const avatarEl = document.getElementById(isMeSlot ? 'my-avatar' : `av-${i}`);
        const balEl = document.getElementById(isMeSlot ? 'my-wallet-amount' : `bal-${i}`);

        if(nameEl) nameEl.innerText = "Vide";
        // Cacher S'ASSEOIR si le joueur est déjà assis à cette table
        if(avatarEl) avatarEl.innerHTML = alreadySeated ? '' : `<button class="btn-sit" onclick="sitDown()">S'ASSEOIR</button>`;

        if(balEl && !isMeSlot) balEl.innerText = "";

        if(!isMeSlot) {
            const hDiv = document.getElementById(`h-${i}`);
            if(hDiv) hDiv.innerHTML = "";
        }
    }

    // Etape B : Mettre à jour MON profil (Slot 1)
    const me = players.find(p => p.id === socket.id);
    if (me) {
        playerMap[socket.id] = 1;
        document.getElementById('my-name').innerText = me.username;
        document.getElementById('my-avatar').innerHTML = `<img src="${me.avatar}" style="width:100%">`;
        
        const myWalletEl = document.getElementById('my-wallet-amount');
        if(myWalletEl) {
            // Sécurité pour afficher 0 si wallet est null
            const myAmount = (me.wallet !== undefined && me.wallet !== null) ? me.wallet : 0;
            myWalletEl.innerText = myAmount + " " + tableCurrency;
        }

        // Ajout du bouton REFRESH si pas déjà présent
        if(!document.getElementById('btn-refresh-wallet')) {
            const refreshBtn = document.createElement('button');
            refreshBtn.id = 'btn-refresh-wallet';
            refreshBtn.innerHTML = "🔄";
            refreshBtn.style = "position:absolute; bottom:0; right:0; background:#3498db; border:none; color:white; border-radius:50%; width:25px; height:25px; cursor:pointer; z-index:20; font-size:12px;";
            refreshBtn.onclick = () => {
                socket.emit('refresh-wallet', { username: user.username, club_id: user.club_id, salon_table_id: salonTableId });
                showAnnouncement("Solde actualisé", 1000);
            };
            document.getElementById('my-avatar').style.position = 'relative';
            document.getElementById('my-avatar').appendChild(refreshBtn);
        }

    }

    // Etape C : Mettre à jour les AUTRES joueurs (Slots 2, 3, 4)
    let otherSlots = [2, 3, 4];
    let slotIdx = 0;
    
    players.forEach(p => {
        if (p.id !== socket.id && slotIdx < otherSlots.length) {
            const currentSlot = otherSlots[slotIdx];
            playerMap[p.id] = currentSlot;
            
            document.getElementById(`n-${currentSlot}`).innerText = p.username;
            document.getElementById(`av-${currentSlot}`).innerHTML = `<img src="${p.avatar}" style="width:100%">`;
            
            const balDiv = document.getElementById(`bal-${currentSlot}`);
            if(balDiv) {
                const amount = (p.wallet !== undefined && p.wallet !== null) ? p.wallet : 0;
                balDiv.innerText = amount + " " + tableCurrency;
                balDiv.style.color = "#f1c40f";
            }
            slotIdx++;
        }
    });

    // --- CORRECTION CRITIQUE DEALER ---
    if (!currentDealerId && players.length > 0) {
        currentDealerId = players[0].id;
        console.log("⚠️ Dealer forcé localement sur :", currentDealerId);
    }

    updateDealerUI();
});

// Gère l'affichage visuel du donneur et du bouton distribuer
socket.on('update-dealer', (data) => {
    console.log("👑 Update Dealer reçu :", data.dealerId);
    currentDealerId = data.dealerId;
    updateDealerUI();
});

function updateDealerUI() {
    // 1. Nettoyage badges
    document.querySelectorAll('.dealer-badge').forEach(b => b.remove());
    
    // 2. Gestion du bouton Distribuer
    const distribBtn = document.getElementById('distribBtn');
    const playerCount = Object.keys(playerMap).length;

    if(distribBtn) {
        if (currentDealerId === socket.id && playerCount >= 2) {
            distribBtn.style.display = 'block';
            if(distribBtn.innerText === "LANCEMENT...") distribBtn.innerText = "DISTRIBUER (3+2)";
        } else {
            distribBtn.style.display = 'none';
        }
    }

    // 3. Affichage Badge Dealer sur l'avatar (Injection Badge)
    const dealerSlot = playerMap[currentDealerId];
    if(dealerSlot) {
        const avatarEl = document.getElementById(dealerSlot === 1 ? 'my-avatar' : `av-${dealerSlot}`);
        if(avatarEl) {
            const badge = document.createElement('div');
            badge.className = 'dealer-badge';
            badge.innerHTML = '🎴';
            badge.style = "position:absolute; top:-5px; right:-5px; background:white; border-radius:50%; width:25px; height:25px; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 4px rgba(0,0,0,0.3); font-size:14px; z-index:10;";
            avatarEl.style.position = 'relative';
            avatarEl.appendChild(badge);
        }
    }
}

// --- 5. LOGIQUE DES BOUTONS D'ACTION ---
function updateActionPanel() {
    if (isObserver) return;
    const actionContainer = document.getElementById('special-actions');
    if(!actionContainer) return;
    
    actionContainer.style.top = "auto";
    actionContainer.style.bottom = "-110px"; 
    actionContainer.innerHTML = ''; 

    // Bouton PASS
    if (isMyTurn && myHand.length === 2 && !isPassing && !hasFolded) {
        const passBtn = document.createElement('button');
        passBtn.className = 'btn-special blink-gold';
        passBtn.innerText = "🃏 SAY PASS";
        passBtn.onclick = () => {
            if(confirm("Voulez-vous bloquer vos 2 dernières cartes (PASS) ?")) {
                socket.emit('player-pass', { club_id: user.club_id, salon_table_id: salonTableId });
            }
        };
        actionContainer.appendChild(passBtn);
    }

    // Bouton BANQUE (Abandonner)
    if (myHand.length > 0 && !hasFolded && !isPassing && cardsPlayedInRound < 2) {
        const bankBtn = document.createElement('button');
        bankBtn.className = 'btn-special';
        bankBtn.style.background = "#c0392b";
        bankBtn.innerText = "🏦 BANQUE";
        bankBtn.onclick = () => {
            if(confirm("Banquer maintenant vous protège du Koratte. Confirmer ?")) {
                socket.emit('fold-hand', { club_id: user.club_id, salon_table_id: salonTableId });
            }
        };
        actionContainer.appendChild(bankBtn);
    }

    // Boutons de VICTOIRE SPÉCIALE
    if (myHand.length === 5 && !hasFolded && !isPassing) {
        const values = myHand.map(c => c.value);
        const suits = myHand.map(c => c.suit);
        const totalPoints = values.reduce((a, b) => a + b, 0);
        const counts = {};
        values.forEach(v => counts[v] = (counts[v] || 0) + 1);
        
        if (Object.values(counts).some(count => count >= 4)) createBonusButton("CARRÉ !", "CARRE");
        if (totalPoints <= 21) createBonusButton(`TCHIA (${totalPoints})`, "TCHIA");
        if (values.filter(v => v === 7).length >= 3) createBonusButton("3 SEPT", "3 SEPT");
        if (suits.every(s => s === suits[0])) {
            const hasThree = values.includes(3);
            createBonusButton(hasThree ? "KORATTE (X2) !" : "COULEUR !", hasThree ? "KORATTE" : "COULEUR");
        }
    }
}

function createBonusButton(label, type) {
    const container = document.getElementById('special-actions');
    const btn = document.createElement('button');
    btn.className = 'btn-special blink-gold';
    btn.innerText = label;
    btn.onclick = () => {
        socket.emit('claim-special-victory', { club_id: user.club_id, salon_table_id: salonTableId, type: type, reason: label });
    };
    container.appendChild(btn);
}

// --- 6. DÉROULEMENT DU JEU ---
socket.on('game-started', (data) => {
    console.log("🚀 La partie commence !");
    clearBoard();
    currentDealerId = data.dealerId;
    document.getElementById('total-pot').innerText = data.pot + " " + tableCurrency;
    document.getElementById('distribBtn').style.display = 'none';

    // BUG-B fix : afficher qui joue en premier dès la distribution
    const statusEl = document.getElementById('status-msg');
    if (statusEl) {
        statusEl.innerText = data.activePlayerId === socket.id
            ? 'À VOUS !'
            : `Tour de ${data.activePlayer}`;
    }

    // Reset états
    hasFolded = false;
    isPassing = false;
    cardsPlayedInRound = 0;
    closeWinnerModal();
    updateDealerUI();

    // BUG-A fix : remplir les mini-mains des adversaires (5 dos de cartes)
    Object.entries(playerMap).forEach(([pid, slot]) => {
        if (pid === socket.id || slot < 2) return;
        const hDiv = document.getElementById(`h-${slot}`);
        if (!hDiv) return;
        hDiv.innerHTML = '';
        for (let j = 0; j < 5; j++) {
            const back = document.createElement('div');
            back.className = 'card-back';
            hDiv.appendChild(back);
        }
    });
});

socket.on('receive-cards', (data) => {
    myHand = data.hand;
    isMyTurn = data.turn;
    hasFolded = false;
    isPassing = false;
    cardsPlayedInRound = 0;
    renderHand();
    updateActionPanel(); 
    updateTurnUI(data.turn ? socket.id : null);
});

function renderHand() {
    const handDiv = document.getElementById('my-hand');
    if(!handDiv) return;
    handDiv.innerHTML = '';
    const icons = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };
    myHand.forEach((card, index) => {
        const cardEl = document.createElement('div');
        const isRed  = (card.suit === 'heart' || card.suit === 'diamond');
        cardEl.className = `card-img ${isRed ? 'red' : ''} ${(hasFolded || isPassing) ? 'folded' : ''}`;
        cardEl.innerHTML = `<span class="cv">${card.value}</span><span class="cs">${icons[card.suit]}</span>`;
        cardEl.onclick = () => {
            if(hasFolded || isPassing) return;
            if(isMyTurn) playCard(index);
            else showCardZoom(card.value, card.suit, null); // hors tour → affiche en grand
        };
        handDiv.appendChild(cardEl);
    });
}

function playCard(index) {
    const card    = myHand[index];
    const handEl  = document.getElementById('my-hand');
    const cardEls = handEl ? handEl.querySelectorAll('.card-img') : [];
    if (cardEls[index]) cardEls[index].classList.add('card-playing');

    socket.emit('card-played', { club_id: user.club_id, salon_table_id: salonTableId, card: card });
    isMyTurn = false;
    // Ne pas retirer la carte immédiatement : on attend display-card ou card-rejected
}

socket.on('player-status-pass', (data) => {
    showAnnouncement(`${data.username} est à PASS !`, 2000);
    if(data.id === socket.id || data.playerId === socket.id) {
        isPassing = true;
        isMyTurn = false;
        renderHand();
        updateActionPanel();
    }
    const slot = playerMap[data.playerId || data.id];
    const nameTag = document.getElementById(slot === 1 ? 'my-name' : `n-${slot}`);
    if(nameTag && !nameTag.innerText.includes("(PASS)")) {
        nameTag.innerHTML += " <b style='color:#f1c40f'>(PASS)</b>";
    }
});

socket.on('display-card', (data) => {
    cardsPlayedInRound++;

    // Retrait de la carte de MA main uniquement quand le serveur confirme
    if (data.playerId === socket.id) {
        myHand = myHand.filter(c => !(c.suit === data.card.suit && c.value === data.card.value));
        renderHand();
    }

    const slotNum = playerMap[data.playerId];
    if (!slotNum) return;
    const targetZone = document.getElementById(`pz-${slotNum}`);
    const icons = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };
    const isRed = (data.card.suit === 'heart' || data.card.suit === 'diamond');

    // Wrapper carte + étiquette joueur
    const wrapper = document.createElement('div');
    wrapper.className = 'card-table-wrapper';

    const cardOnTable = document.createElement('div');
    cardOnTable.className = `card-on-table ${isRed ? 'red' : ''}`;
    cardOnTable.innerHTML = `<span class="cv">${data.card.value}</span><span class="cs">${icons[data.card.suit]}</span>`;

    const playerNameEl = document.createElement('div');
    playerNameEl.className = 'card-player-name';
    playerNameEl.textContent = data.username || '';

    // Tap/clic → zoom plein écran
    const rawName = document.getElementById(slotNum === 1 ? 'my-name' : `n-${slotNum}`)?.innerText || data.username || '';
    wrapper.onclick = () => showCardZoom(data.card.value, data.card.suit, rawName);

    wrapper.appendChild(cardOnTable);
    wrapper.appendChild(playerNameEl);
    if (targetZone) targetZone.appendChild(wrapper);

    if (slotNum > 1) {
        const hDiv = document.getElementById(`h-${slotNum}`);
        if (hDiv && hDiv.lastChild) hDiv.removeChild(hDiv.lastChild);
    }
    updateActionPanel();
});

socket.on('player-folded', (data) => {
    showAnnouncement(`${data.username} BANQUE`, 2000);
    if(data.id === socket.id) {
        hasFolded = true;
        renderHand();
        updateActionPanel();
    }
});

socket.on('clear-table', (data) => {
    // BUG-02 + BUG-03 corrigés : reset du compteur et nettoyage visuel entre chaque pli
    cardsPlayedInRound = 0;
    isMyTurn = (socket.id === data.winnerId);
    updateTurnUI(data.winnerId);
    updateActionPanel();
    setTimeout(() => {
        clearBoard();
    }, 800);
});

socket.on('next-turn', (data) => {
    isMyTurn = (socket.id === data.activePlayerId);
    document.getElementById('status-msg').innerText = isMyTurn ? "À VOUS !" : `Tour de ${data.activeUsername}`;
    updateTurnUI(data.activePlayerId);
    updateActionPanel();
    // Cacher le timer entre les tours
    const timerEl = document.getElementById('turn-timer');
    if (timerEl) timerEl.style.display = 'none';
});

socket.on('game-over', (data) => {
    const modal = document.getElementById('winner-modal');
    if(modal) {
        document.getElementById('winner-name').innerText = data.winnerUsername;
        document.getElementById('winner-avatar').innerHTML = `<img src="${data.winnerAvatar}" style="width:100%">`;
        document.getElementById('winner-gain').innerText = data.potAmount + " " + tableCurrency;
        document.getElementById('status-msg').innerText = data.reason || "Partie terminée";
        modal.style.display = 'flex';
    }
    if(data.newDealerId) currentDealerId = data.newDealerId;
    myHand = [];
    hasFolded = false;
    isPassing = false;
    cardsPlayedInRound = 0;
    renderHand();
    const actionsEl = document.getElementById('special-actions');
    actionsEl.innerHTML = '';
    if (salonTableId) {
        const btn = document.createElement('button');
        btn.className = 'btn-special';
        btn.style.background = '#2980b9';
        btn.innerText = 'RETOUR AU SALON';
        btn.onclick = () => {
            localStorage.removeItem('salon_table_id');
            localStorage.removeItem('salon_observer');
            window.location.href = 'salon.html';
        };
        actionsEl.style.display = '';
        actionsEl.appendChild(btn);
    }
    updateDealerUI();
    // Cacher le timer en fin de partie
    const timerGOEl = document.getElementById('turn-timer');
    if (timerGOEl) timerGOEl.style.display = 'none';
});

// Écouteur pour erreur de démarrage
socket.on('game-start-failed', (data) => {
    console.error("❌ Echec démarrage:", data);
    alert(data.message || "Impossible de démarrer la partie (Fonds insuffisants ?)");
    const btn = document.getElementById('distribBtn');
    if(btn) btn.innerText = "DISTRIBUER (3+2)";
});

// BUG-01 : rejet d'une victoire spéciale frauduleuse
socket.on('claim-rejected', (data) => {
    showAnnouncement(`❌ ${data.reason}`, 4000);
    console.warn('[SÉCURITÉ] Claim rejeté:', data.reason);
});

// Sprint 5 : rejet d'une carte invalide (validation serveur)
socket.on('card-rejected', (data) => {
    showAnnouncement(`❌ ${data.reason}`, 4000);
    console.warn('[RÈGLE] Carte rejetée:', data.reason);
    // Restaurer le tour : la carte est encore dans myHand (pas de retrait optimiste)
    isMyTurn = true;
    renderHand();
    updateActionPanel();
});

// Sprint 5 : compte refusé à la table (suspendu)
socket.on('join-refused', (data) => {
    alert(`Accès refusé : ${data.reason}`);
    console.warn('[ACCÈS] Rejoindre refusé:', data.reason);
    window.location.replace(salonTableId ? 'salon.html' : 'index.html');
});

// Sprint 5 : déconnexion forcée (suspension en cours de partie ou check périodique)
socket.on('force-disconnect', (data) => {
    alert(`Vous avez été déconnecté : ${data.reason}`);
    console.warn('[SÉCURITÉ] Force-disconnect:', data.reason);
    localStorage.clear();
    sessionStorage.clear();
    window.location.replace('index.html');
});

// --- 7. UTILITAIRES & ACTIONS JOUEUR ---
function clearBoard() {
    for(let i=1; i<=4; i++) {
        const pz = document.getElementById(`pz-${i}`);
        if(pz) pz.innerHTML = "";
    }
}

function updateTurnUI(activeId) {
    document.querySelectorAll('.player-slot').forEach(s => s.classList.remove('active-turn'));
    const activeSlot = playerMap[activeId];
    if(activeSlot) {
        const slotEl = document.getElementById(`slot-${activeSlot}`);
        if(slotEl) slotEl.classList.add('active-turn');
    }
}

function closeWinnerModal() {
    document.getElementById('winner-modal').style.display = 'none';
    // BUG-E fix : effacer le bouton "RETOUR AU SALON" avant la manche suivante
    const actEl = document.getElementById('special-actions');
    if (actEl) actEl.innerHTML = '';
    updateDealerUI();
    clearBoard();
}

function sitDown() {
    if (salonTableId) {
        socket.emit('sit-at-table', { salon_table_id: salonTableId, username: user.username, stake: user.stake });
    } else {
        socket.emit('join-table', { club_id: user.club_id, username: user.username, stake: user.stake });
    }
}

// === FONCTION CRITIQUE : DISTRIBUER ===
function requestDistribute() {
    console.log("👉 Clic sur Distribuer...");

    const myWalletText = document.getElementById('my-wallet-amount')?.innerText || "0";
    const myBalance = parseInt(myWalletText);
    
    if(myBalance < user.stake) {
        alert("Attention: Vos fonds affichés semblent insuffisants. Tentative quand même...");
    }

    if(Object.keys(playerMap).length < 2) {
        alert("Il faut au moins 2 joueurs !");
        return;
    }

    const btn = document.getElementById('distribBtn');
    if(btn) btn.innerText = "LANCEMENT...";

    socket.emit('start-game', {
        club_id: user.club_id,
        salon_table_id: salonTableId,
        username: user.username
    });
}

function standUp() {
    socket.emit('stand-up', { club_id: user.club_id, salon_table_id: salonTableId });
    myHand = []; hasFolded = false; isPassing = false;
    renderHand(); closeWinnerModal();
    if (salonTableId) {
        localStorage.removeItem('salon_table_id');
        window.location.href = 'salon.html';
    }
}

function leaveClub() {
    if (isObserver && salonTableId) {
        socket.emit('leave-table', { salon_table_id: salonTableId });
    } else {
        socket.emit('stand-up', { club_id: user.club_id, salon_table_id: salonTableId });
    }
    localStorage.removeItem('salon_table_id');
    localStorage.removeItem('salon_observer');
    window.location.replace(salonTableId ? 'salon.html' : 'index.html');
}

function showAnnouncement(text, duration = 2000) {
    const el = document.getElementById('announcement');
    if(el) {
        el.innerText = text;
        el.style.opacity = "1";
        setTimeout(() => { el.style.opacity = "0"; }, duration);
    }
}

// =====================================================
// TIMER DE TOUR (turn-tick)
// =====================================================

const TURN_TOTAL_SEC = 30;

socket.on('turn-tick', (data) => {
    const timerEl = document.getElementById('turn-timer');
    const secEl   = document.getElementById('timer-sec');
    const barEl   = document.getElementById('timer-bar');
    if (!timerEl) return;

    const s = data.secondsLeft;

    if (s <= 0) {
        timerEl.style.display = 'none';
        return;
    }

    timerEl.style.display = 'flex';
    secEl.innerText = s;
    secEl.className = s <= 8 ? 'urgent' : '';

    const pct = Math.max(0, (s / TURN_TOTAL_SEC) * 100);
    barEl.style.width      = pct + '%';
    barEl.style.background = s > 10 ? '#2ecc71' : (s > 5 ? '#e67e22' : '#e74c3c');
});

// =====================================================
// CHANGER DE TABLE (modal)
// =====================================================

function handleLeave() {
    if (salonTableId) {
        openChangeTableModal();
    } else {
        standUp();
    }
}

function openChangeTableModal() {
    const modal = document.getElementById('modal-change-table');
    const list  = document.getElementById('ct-table-list');
    modal.classList.add('open');
    list.innerHTML = '<p style="color:#666;text-align:center;padding:20px 0">Chargement...</p>';

    fetch(BACKEND_URL + '/api/salon/tables')
        .then(r => r.json())
        .then(tables => {
            if (!tables || tables.length === 0) {
                list.innerHTML = '<p style="color:#666;text-align:center;padding:20px 0">Aucune table disponible.</p>';
                return;
            }
            list.innerHTML = tables.map(t => {
                const isPlaying = t.status === 'playing';
                const isCurrent = t.table_id === salonTableId;
                const locked    = isPlaying || isCurrent;
                const badge     = isPlaying
                    ? '<span class="ct-badge ct-badge-playing">En cours</span>'
                    : '<span class="ct-badge ct-badge-open">Libre</span>';
                const click = locked ? '' : `onclick="selectChangeTable(${t.table_id})"`;
                const label = isCurrent ? ' (table actuelle)' : '';
                return `
                    <div class="ct-row ${locked ? 'ct-locked' : ''}" ${click}>
                        <span class="ct-name">${t.table_name}${label}</span>
                        <span class="ct-info">${t.seated_count || 0}/${t.max_players} · ${t.min_bet} ${t.currency || 'FCFA'}</span>
                        ${badge}
                    </div>`;
            }).join('');
        })
        .catch(() => {
            list.innerHTML = '<p style="color:#e74c3c;text-align:center;padding:20px 0">Erreur de chargement.</p>';
        });
}

function closeChangeTable() {
    document.getElementById('modal-change-table').classList.remove('open');
}

function goToSalon() {
    if (salonTableId) {
        socket.emit('leave-table', { salon_table_id: salonTableId });
        localStorage.removeItem('salon_table_id');
        localStorage.removeItem('salon_observer');
    }
    window.location.href = 'salon.html';
}

function selectChangeTable(newTableId) {
    if (!newTableId || newTableId === salonTableId) return;
    socket.emit('change-table', {
        from_table_id: salonTableId,
        to_table_id:   newTableId
    });
    closeChangeTable();
}

// =====================================================
// ZOOM CARTE (tap sur une carte posée sur la table)
// =====================================================

const CARD_ICONS = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };

function showCardZoom(value, suit, playerName) {
    const modal   = document.getElementById('card-zoom-modal');
    const face    = document.getElementById('card-zoom-face');
    const top     = document.getElementById('czv-top');
    const center  = document.getElementById('czs-center');
    const bottom  = document.getElementById('czv-bottom');
    const playerEl= document.getElementById('card-zoom-player');
    if (!modal || !face) return;

    const icon  = CARD_ICONS[suit] || suit;
    const isRed = suit === 'heart' || suit === 'diamond';

    face.className = `card-zoom-face${isRed ? ' red' : ''}`;
    top.textContent    = value;
    center.textContent = icon;
    bottom.textContent = value;

    playerEl.textContent = playerName && playerName !== 'Vide' && playerName !== 'Spectateur'
        ? `Jouée par ${playerName.replace(/\s*\(.*\)/, '').trim()}`
        : '';

    modal.classList.add('open');
}

function closeCardZoom() {
    document.getElementById('card-zoom-modal')?.classList.remove('open');
}

socket.on('change-table-ack', (data) => {
    localStorage.setItem('salon_table_id', data.salon_table_id);
    localStorage.removeItem('salon_observer');
    window.location.reload();
});

// =====================================================
// RECONNEXION (perte réseau temporaire)
// =====================================================

// Socket.IO se reconnecte automatiquement après une micro-coupure réseau.
// On ré-émet join/sit pour retrouver la partie en cours.
socket.on('connect', () => {
    if (!socket._hasConnectedOnce) { socket._hasConnectedOnce = true; return; }
    // Reconnexion automatique Socket.IO : ré-identifier le joueur
    const token = localStorage.getItem('token');
    if (token) socket.emit('authenticate', token);
    if (salonTableId) {
        socket.emit('sit-at-table', { salon_table_id: salonTableId, username: user.username });
    } else if (user.club_id) {
        socket.emit('join-table', { club_id: user.club_id, username: user.username, stake: user.stake });
    }
});

socket.on('player-disconnected', (data) => {
    showAnnouncement(`⚡ ${data.username} déconnecté — ${data.reconnectSec}s`, 3000);
    const slot = playerMap[data.id];
    if (slot) {
        const nameEl = document.getElementById(slot === 1 ? 'my-name' : `n-${slot}`);
        if (nameEl && !nameEl.innerHTML.includes('dc-tag')) {
            nameEl.innerHTML += ' <span class="dc-tag" style="color:#e74c3c;font-size:0.75em">(DC)</span>';
        }
    }
});

socket.on('player-reconnected', (data) => {
    showAnnouncement(`✅ ${data.username} reconnecté !`, 2000);
    // player-list-update qui suit nettoie l'indicateur DC
});

socket.on('reconnect-state', (data) => {
    document.getElementById('total-pot').innerText = data.pot + ' ' + tableCurrency;
    if (data.activePlayerId) {
        isMyTurn = (data.activePlayerId === socket.id);
        const statusEl = document.getElementById('status-msg');
        if (statusEl) statusEl.innerText = isMyTurn ? 'À VOUS !' : `Tour de ${data.activeUsername}`;
        updateTurnUI(data.activePlayerId);
    }
    // Remettre les cartes sur la table
    clearBoard();
    const icons = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };
    (data.cardsOnTable || []).forEach(entry => {
        const slotNum = playerMap[entry.playerId];
        if (!slotNum) return;
        const targetZone = document.getElementById(`pz-${slotNum}`);
        if (!targetZone) return;
        const isRed = (entry.card.suit === 'heart' || entry.card.suit === 'diamond');
        const wrapper = document.createElement('div');
        wrapper.className = 'card-table-wrapper';
        const cardEl = document.createElement('div');
        cardEl.className = `card-on-table ${isRed ? 'red' : ''}`;
        cardEl.innerHTML = `<span class="cv">${entry.card.value}</span><span class="cs">${icons[entry.card.suit]}</span>`;
        const nameEl2 = document.createElement('div');
        nameEl2.className = 'card-player-name';
        nameEl2.textContent = entry.username || '';
        wrapper.appendChild(cardEl);
        wrapper.appendChild(nameEl2);
        targetZone.appendChild(wrapper);
    });
    updateActionPanel();
});

