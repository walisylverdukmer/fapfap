const user = JSON.parse(localStorage.getItem('user'));

async function initDashboard() {
    // Si pas de session, retour au login
    if (!user) {
        window.location.href = "index.html";
        return;
    }

    // Affichage du nom d'utilisateur
    const welcomeMsg = document.getElementById('welcomeMsg');
    if (welcomeMsg) welcomeMsg.innerText = `Bienvenue, ${user.username}`;

    // 1. Affichage Panel SuperAdmin (Wali Sylver)
    if (user.role === 'superadmin') {
        const adminPanel = document.getElementById('adminPanel');
        if (adminPanel) {
            adminPanel.style.display = 'block';
            setupAdminForm(); // Active la logique du formulaire
        }
    }

    // 2. Gestion Espace Katika
    const katikaSection = document.getElementById('katikaSection');
    if (katikaSection && (user.role === 'katika' || user.role === 'superadmin')) {
        katikaSection.innerHTML = `
            <div class="card pro-card" onclick="window.location.href='club-manage.html'" 
                 style="border: 2px solid gold; background: rgba(212, 175, 55, 0.1); cursor:pointer; padding: 20px;">
                <h3 style="color: gold; margin:0;">🎖️ Accéder à mon espace Katika</h3>
                <p>Gérez vos clubs, vos joueurs et vos commissions.</p>
            </div>
        `;
    }

    // 3. Chargement des clubs
    loadAvailableClubs();
}

// --- LOGIQUE POUR WALI SYLVER (CRÉATION KATIKA + CLUB) ---
function setupAdminForm() {
    const addKatikaForm = document.getElementById('addKatikaForm');
    if (!addKatikaForm) return;

    addKatikaForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Récupération des données du formulaire
        const formData = {
            username: document.getElementById('k_name').value,
            phone: document.getElementById('k_phone').value,
            password: document.getElementById('k_pass').value,
            clubName: document.getElementById('k_club').value // Nouveau champ ajouté
        };

        try {
            const response = await fetch('http://localhost:5000/api/auth/register-katika', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            const data = await response.json();

            if (response.ok) {
                alert(`Succès : ${data.msg}`);
                addKatikaForm.reset();
            } else {
                alert(`Erreur : ${data.msg || "Une erreur est survenue"}`);
            }
        } catch (error) {
            console.error("Erreur réseau :", error);
            alert("Impossible de contacter le serveur.");
        }
    });
}

// --- AFFICHAGE DES SALLES DISPONIBLES ---
async function loadAvailableClubs() {
    const grid = document.getElementById('clubsGrid');
    if (!grid) return;

    // Simulation de données - À remplacer par fetch('api/money/clubs-list') plus tard
    const clubs = [
        { id: 1, name: "Abidjan Prestige", country: "CI 🇨🇮", players: 145, stake: 500 },
        { id: 2, name: "Yaoundé Ace", country: "CM 🇨🇲", players: 89, stake: 1000 },
        { id: 3, name: "Dakar Royale", country: "SN 🇸🇳", players: 210, stake: 500 }
    ];

    grid.innerHTML = clubs.map(club => `
        <div class="card club-card" style="text-align: center; border: 1px solid #d4af37;">
            <div class="suit-icon" style="color: #d4af37;">♠️</div>
            <h4>${club.name}</h4>
            <p style="font-size: 0.8rem; margin: 5px 0;">${club.country}</p>
            <p><strong>Mise : ${club.stake} FCFA</strong></p>
            <small>${club.players} joueurs en ligne</small><br>
            <button onclick="joinGame(${club.id})" style="margin-top: 10px; width: 100%; background: #d4af37; color: black; font-weight: bold;">
                REJOINDRE
            </button>
        </div>
    `).join('');
}

function joinGame(clubId) {
    window.location.href = `game.html?club_id=${clubId}`;
}

function logout() {
    localStorage.clear();
    window.location.href = "index.html";
}

// Lancement
initDashboard();