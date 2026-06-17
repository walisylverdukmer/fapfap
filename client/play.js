// =====================================================
// FAP FAP 2.0 — Page d'accès rapide /play
// Login si téléphone existant, inscription sinon.
// =====================================================

const form        = document.getElementById('play-form');
const phoneInput  = document.getElementById('play-phone');
const usernameInput = document.getElementById('play-username');
const passwordInput = document.getElementById('play-password');
const errorEl     = document.getElementById('play-error');
const successEl   = document.getElementById('play-success');
const submitBtn   = document.getElementById('play-submit');
const usernameGrp = document.getElementById('username-group');

// Rediriger si déjà connecté
const existing = localStorage.getItem('token');
if (existing) {
    window.location.replace('salon.html?auto=1');
}

// Lire le token d'invitation éventuel dans l'URL (?table=TOKEN)
const urlParams    = new URLSearchParams(window.location.search);
const inviteToken  = urlParams.get('table');
const autoAssign   = urlParams.get('auto');

// Révéler le champ "sobriquet" après saisie du téléphone
// (on le montre toujours pour les nouveaux joueurs — géré côté serveur)
phoneInput.addEventListener('blur', async () => {
    const phone = phoneInput.value.trim();
    if (!phone) return;

    // Vérifier si le numéro existe (endpoint léger — uniquement statut)
    try {
        const res  = await fetch(BACKEND_URL + '/api/auth/check-phone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
        });
        const data = await res.json();
        if (data.exists) {
            // Joueur existant — pas besoin du sobriquet
            usernameGrp.style.display = 'none';
            usernameInput.removeAttribute('required');
            submitBtn.innerText = 'SE CONNECTER';
        } else {
            // Nouveau joueur
            usernameGrp.style.display = 'block';
            usernameInput.setAttribute('required', 'required');
            submitBtn.innerText = "CRÉER MON COMPTE";
        }
    } catch {
        // En cas d'erreur réseau, afficher le champ sobriquet par défaut
        usernameGrp.style.display = 'block';
    }
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const phone    = phoneInput.value.trim();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    hideMessages();

    if (!phone || !password) {
        showError('Téléphone et mot de passe requis.');
        return;
    }

    submitBtn.disabled  = true;
    submitBtn.innerText = 'CONNEXION EN COURS...';

    try {
        const res = await fetch(BACKEND_URL + '/api/auth/register-or-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, username, password })
        });

        const data = await res.json();

        if (!res.ok) {
            showError(data.msg || 'Erreur de connexion.');
            return;
        }

        // Succès
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));

        if (data.isNew) {
            showSuccess('Compte créé ! Bienvenue ' + data.user.username + '...');
        }

        // Redirection avec attribution automatique de table
        setTimeout(() => {
            if (inviteToken) {
                window.location.href = 'salon.html?invite=' + inviteToken;
            } else {
                window.location.href = 'salon.html?auto=1';
            }
        }, data.isNew ? 1200 : 300);

    } catch {
        showError('Erreur réseau. Vérifiez votre connexion.');
    } finally {
        submitBtn.disabled  = false;
        submitBtn.innerText = 'ENTRER DANS LE SALON';
    }
});

function showError(msg) {
    errorEl.innerText  = msg;
    errorEl.style.display = 'block';
    successEl.style.display = 'none';
}

function showSuccess(msg) {
    successEl.innerText = msg;
    successEl.style.display = 'block';
    errorEl.style.display = 'none';
}

function hideMessages() {
    errorEl.style.display   = 'none';
    successEl.style.display = 'none';
}
