document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const phone = document.getElementById('phone').value;
    const password = document.getElementById('password').value;
    const messageDiv = document.getElementById('message');

    console.log("Tentative de connexion pour:", phone);

    try {
        const response = await fetch('http://localhost:5000/api/auth/login', {
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
                console.log("Accès standard. Redirection vers Dashboard...");
                window.location.replace("dashboard.html");
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