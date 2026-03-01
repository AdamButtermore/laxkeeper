// LaxKeeper Service Worker
// Caches app shell for offline use and fast loading

var CACHE_NAME = 'laxkeeper-v7';
var URLS_TO_CACHE = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/firebase-config.js',
    '/firebase-sync.js',
    '/logo.png',
    '/icon-192.png',
    '/icon-512.png',
    '/apple-touch-icon.png',
    '/manifest.json'
];

// Install — cache app shell
self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function (cache) {
            console.log('[SW] Caching app shell');
            return cache.addAll(URLS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

// Activate — clean up old caches
self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (names) {
            return Promise.all(
                names.filter(function (name) {
                    return name !== CACHE_NAME;
                }).map(function (name) {
                    console.log('[SW] Deleting old cache:', name);
                    return caches.delete(name);
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch — network first, fall back to cache
self.addEventListener('fetch', function (event) {
    // Skip non-GET and Firebase/external requests
    if (event.request.method !== 'GET') return;
    var url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(event.request).then(function (response) {
            // Update cache with fresh copy
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
                cache.put(event.request, clone);
            });
            return response;
        }).catch(function () {
            // Network failed — serve from cache
            return caches.match(event.request);
        })
    );
});
