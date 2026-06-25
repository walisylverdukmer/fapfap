// FAP FAP — Service Worker
// Stratégie : network-first pour les pages, cache-first pour les assets statiques.
// Socket.IO et /api/ ne sont jamais interceptés (toujours réseau).

const CACHE = 'fapfap-v1';

const APP_SHELL = [
    '/',
    '/index.html',
    '/salon.html',
    '/game.html',
    '/player-view.html',
    '/dashboard-pro.html',
    '/dashboard.html',
    '/club-manage.html',
    '/play.html',
    '/style.css',
    '/config.js',
    '/auth-guard.js',
    '/script.js',
    '/salon.js',
    '/role-switcher.js',
    '/icons/icon.svg'
];

// Installation : mise en cache de l'app shell
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(APP_SHELL)).catch(() => {})
    );
    self.skipWaiting();
});

// Activation : supprimer les anciens caches
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch : laisser passer Socket.IO + API, network-first pour le reste
self.addEventListener('fetch', (e) => {
    const url = e.request.url;

    // Ne jamais intercepter Socket.IO, les API REST, ou les requêtes non-GET
    if (
        e.request.method !== 'GET' ||
        url.includes('/socket.io/') ||
        url.includes('/api/')
    ) {
        return;
    }

    e.respondWith(
        fetch(e.request)
            .then(res => {
                // Mettre en cache si la réponse est valide
                if (res && res.status === 200 && res.type === 'basic') {
                    const clone = res.clone();
                    caches.open(CACHE).then(c => c.put(e.request, clone));
                }
                return res;
            })
            .catch(() => caches.match(e.request))
    );
});
