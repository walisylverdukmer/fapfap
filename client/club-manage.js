const user = JSON.parse(localStorage.getItem('user'));
const token = localStorage.getItem('token');

// Sécurité : Redirection si non connecté ou rôle inapproprié
if (!user || (user.role !== 'katika' && user.role !== 'superadmin')) {
    window.location.replace("index.html");
}

async function initClub() {
    // Affichage infos utilisateur
    const displayElem = document.getElementById('userDisplay');
    if(displayElem) {
        displayElem.innerText = `${user.username} (${user.role.toUpperCase()})`;
    }
    
    // Si Wali est là, on montre le bouton vers le Dashboard Pro
    const adminLink = document.getElementById('link-admin');
    if (user.role === 'superadmin' && adminLink) {
        adminLink.style.display = 'block';
    }

    // Charger la liste au démarrage
    loadClubPlayers();

    // Gestion de l'ajout de joueur
    const addForm = document.getElementById('addPlayerForm');
    if (addForm) {
        addForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const data = {
                username: document.getElementById('p_username').value,
                phone: document.getElementById('p_phone').value,
                password: document.getElementById('p_password').value,
                wallet: document.getElementById('p_wallet').value || 0,
                club_id: user.club_id,
                role: 'player'
            };

            try {
                const response = await fetch(BACKEND_URL + '/api/auth/register-player', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}` // Token ajouté ici
                    },
                    body: JSON.stringify(data)
                });

                const result = await response.json();

                if (response.ok) {
                    alert("✅ Joueur inscrit avec succès !");
                    location.reload();
                } else {
                    alert("❌ Erreur : " + result.msg);
                }
            } catch (error) {
                console.error("Erreur serveur:", error);
                alert("Le serveur ne répond pas.");
            }
        });
    }
}

async function loadClubPlayers() {
    // Note: Utilise 'playerListContainer' ou 'playersTableBody' selon ton HTML
    const container = document.getElementById('playerListContainer') || document.getElementById('playersTableBody');
    
    if (!container) return;

    // Sécurité locale : Si le club_id est manquant dans le stockage
    if (!user.club_id) {
        container.innerHTML = `<div style="text-align:center; color:orange; padding:20px;">⚠️ Erreur : Club non identifié. Veuillez vous reconnecter.</div>`;
        return;
    }
    
    try {
        // AJOUT CRUCIAL DU TOKEN DANS LES HEADERS
        const response = await fetch(`${BACKEND_URL}/api/money/club-players/${user.club_id}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.msg || "Erreur lors de la récupération");
        }

        const players = await response.json();

        if (!players || players.length === 0) {
            container.innerHTML = `<div style="text-align:center; color:#888; padding:20px;">Aucun joueur trouvé dans ce club.</div>`;
            return;
        }

        // Rendu des cartes de joueurs
        container.innerHTML = players.map(p => `
            <div class="player-card" style="background:#1a1a1a; padding:15px; border-radius:8px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; border:1px solid #333;">
                <div class="player-info">
                    <strong style="color:white; display:block;">${p.username}</strong>
                    <span style="font-size:0.8rem; color:#888;">📞 ${p.phone || 'N/A'}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 15px;">
                    <div class="balance-badge" style="background:rgba(212,175,55,0.1); color:#d4af37; padding:5px 10px; border-radius:5px; font-weight:bold;">
                        ${Number(p.wallet).toLocaleString()} FCFA
                    </div>
                    <button onclick="manageBalance(${p.id}, '${p.username}')" style="background:#d4af37; border:none; padding:8px 12px; border-radius:4px; color:black; font-weight:bold; cursor:pointer;">
                        💰 GÉRER
                    </button>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error("Erreur chargement joueurs:", err);
        container.innerHTML = `<div style="color:red; text-align:center; padding:20px;">❌ ${err.message}</div>`;
    }
}

// Fonction de transfert mise à jour pour utiliser la route /transfer existante
async function manageBalance(playerId, playerName) {
    const amount = prompt(`Montant à créditer à ${playerName} (FCFA) :`);
    
    if (amount && !isNaN(amount) && amount > 0) {
        try {
            const response = await fetch(BACKEND_URL + '/api/money/transfer', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ 
                    receiver_id: playerId, 
                    amount: parseInt(amount) 
                })
            });

            const result = await response.json();

            if (response.ok) {
                alert(`✅ ${amount} FCFA ont été crédités à ${playerName}.`);
                loadClubPlayers(); // Rafraîchir la liste
            } else {
                alert("❌ Erreur : " + result.msg);
            }
        } catch (error) {
            alert("Erreur lors de la transaction.");
        }
    }
}

function logout() {
    localStorage.clear();
    window.location.href = "index.html";
}

// Lancement
initClub();