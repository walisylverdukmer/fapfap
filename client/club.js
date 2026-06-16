// club.js
const user = JSON.parse(localStorage.getItem('user'));

function createPlayer() {
    const name = document.getElementById('p_name').value;
    const phone = document.getElementById('p_phone').value;

    if(!name || !phone) return alert("Remplis les champs !");

    // Ici on appellera la route API qu'on créera juste après
    alert(`Joueur ${name} enregistré pour le club ${user.club_id}`);
    
    // Ajout visuel immédiat dans le tableau pour le test
    const tbody = document.getElementById('playerTableBody');
    tbody.innerHTML += `
        <tr>
            <td>${name}</td>
            <td>0 FCFA</td>
            <td><button>Recharger</button></td>
        </tr>
    `;
}