// Vérification de sécurité au chargement
const user = JSON.parse(localStorage.getItem('user'));
const token = localStorage.getItem('token');

if (!user || user.role !== 'superadmin') {
    window.location.replace("index.html");
}

// Initialisation de la page
async function initAdmin() {
    document.getElementById('adminDisplay').innerText = `${user.username} (SuperAdmin)`;
    
    // Charger les données initiales
    loadKatikaList();
    // loadStats(); // Optionnel : pour remplir les compteurs de mises
}

// --- 1. GESTION DU RECRUTEMENT ---
document.getElementById('addKatikaFormPro').addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = {
        username: document.getElementById('k_name').value,
        phone: document.getElementById('k_phone').value,
        password: document.getElementById('k_pass').value,
        clubName: document.getElementById('k_club').value
    };

    try {
        const response = await fetch(BACKEND_URL + '/api/auth/register-katika', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (response.ok) {
            alert("✅ " + result.msg);
            document.getElementById('addKatikaFormPro').reset();
            loadKatikaList(); // Rafraîchir la liste sans recharger la page
        } else {
            alert("❌ Erreur : " + result.msg);
        }
    } catch (error) {
        console.error("Erreur réseau:", error);
        alert("Impossible de contacter le serveur.");
    }
});

// --- 2. AFFICHAGE DES KATIKAS ET CLUBS ---
async function loadKatikaList() {
    const tableBody = document.getElementById('katikaTableBody');
    
    try {
        // Note : Tu devras créer cette route dans moneyRoutes ou authRoutes
        // Pour l'instant, on récupère tous les utilisateurs ayant le rôle 'katika'
        const response = await fetch(BACKEND_URL + '/api/money/all-katikas', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const katikas = await response.json();

        if (!katikas || katikas.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#555; padding:20px;">Aucun Katika recruté pour le moment.</td></tr>`;
            return;
        }

        tableBody.innerHTML = katikas.map(k => `
            <tr>
                <td>
                    <div style="font-weight:bold; color:white;">${k.username}</div>
                    <div style="font-size:0.75rem; color:#666;">📞 ${k.phone}</div>
                </td>
                <td>
                    <span class="badge-katika">${k.club_name || 'Sans Club'}</span>
                </td>
                <td>
                    <span style="color:var(--pro-gold); font-weight:bold;">${k.wallet.toLocaleString()} FCFA</span>
                </td>
                <td>
                    <span style="color:#4caf50; font-size:0.8rem;">● ACTIF</span>
                </td>
                <td>
                    <button onclick="rechargeKatika(${k.id}, '${k.username}')" style="background:#222; border:1px solid var(--pro-gold); color:var(--pro-gold); padding:5px 10px; border-radius:4px; cursor:pointer; font-size:0.7rem;">
                        💰 DOTER
                    </button>
                </td>
            </tr>
        `).join('');

        // Mise à jour rapide du compteur de clubs
        document.getElementById('statClubs').innerText = katikas.length;

    } catch (error) {
        console.error("Erreur chargement liste:", error);
        tableBody.innerHTML = `<tr><td colspan="5" style="color:red; text-align:center;">Erreur lors de la récupération des données.</td></tr>`;
    }
}

// --- 3. FONCTIONS AUXILIAIRES ---
function rechargeKatika(id, name) {
    const amount = prompt(`Montant de la dotation pour ${name} (FCFA) :`);
    if (amount && !isNaN(amount)) {
        // Ici, appel à ta route de transfert créée précédemment
        transferToKatika(id, amount);
    }
}

async function transferToKatika(id, amount) {
    try {
        const response = await fetch(BACKEND_URL + '/api/money/transfer', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ receiver_id: id, amount: parseInt(amount) })
        });

        if (response.ok) {
            alert("✅ Dotation effectuée !");
            loadKatikaList();
        } else {
            alert("❌ Échec du transfert.");
        }
    } catch (error) {
        alert("Erreur serveur.");
    }
}

function logout() {
    localStorage.clear();
    window.location.replace("index.html");
}

// Lancement
initAdmin();