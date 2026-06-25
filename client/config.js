// URL du serveur FAP FAP — auto-détectée selon l'environnement
// Dev  : localhost → http://localhost:5000
// Prod : Render   → window.location.origin (même domaine)
const BACKEND_URL = (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
) ? 'http://localhost:5000' : window.location.origin;

// Enregistrement du Service Worker (PWA)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}
