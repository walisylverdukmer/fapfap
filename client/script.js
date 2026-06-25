// ── Rediriger les utilisateurs déjà connectés ────────────────
// Couvre deux cas :
//   1. Chargement normal alors qu'une session est active (token valide en localStorage)
//   2. Restauration bfcache après "précédent" depuis une page protégée
(function redirectIfAuthenticated() {
    try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const b64     = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(b64));
        if (payload.exp * 1000 <= Date.now()) return; // token expiré
        const u = JSON.parse(localStorage.getItem('user') || 'null');
        if (!u) return;
        const dest = u.role === 'superadmin' ? 'dashboard-pro.html' : 'salon.html';
        window.location.replace(dest);
    } catch {}
})();

window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return; // restauration bfcache uniquement
    // Même logique : si l'utilisateur est toujours connecté, quitter la page login
    try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const b64     = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(b64));
        if (payload.exp * 1000 <= Date.now()) return;
        const u = JSON.parse(localStorage.getItem('user') || 'null');
        if (!u) return;
        window.location.replace(u.role === 'superadmin' ? 'dashboard-pro.html' : 'salon.html');
    } catch {}
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const phone = document.getElementById('phone').value;
    const password = document.getElementById('password').value;
    const messageDiv = document.getElementById('message');

    console.log("Tentative de connexion pour:", phone);

    try {
        const response = await fetch(BACKEND_URL + '/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, password })
        });

        const data = await response.json();

        if (response.ok) {
            console.log("Connexion réussie !");
            
            // 1. Stockage du Token et de l'objet User (contient le rôle)
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));

            // 2. Redirection intelligente selon le rôle
            if (data.user.role === 'superadmin') {
                console.log("Accès Admin détecté. Redirection vers Dashboard Pro...");
                window.location.replace("dashboard-pro.html");
            } else {
                console.log("Accès standard. Redirection vers Salon...");
                window.location.replace("salon.html");
            }
            
        } else {
            messageDiv.style.color = "#ff4444";
            messageDiv.innerText = data.msg || "Erreur de connexion";
        }
    } catch (error) {
        console.error("Erreur Fetch:", error);
        messageDiv.innerText = "Le serveur ne répond pas. Vérifie ton terminal Node.";
    }
});