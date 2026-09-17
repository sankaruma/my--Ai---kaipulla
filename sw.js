/* ==========================================================================
   NIZHAL THUNAI - SERVICE WORKER (PWA Offline & Push Notifications)
   ========================================================================== */

const CACHE_NAME = 'nizhal-thunai-v8';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// Install Event
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[ServiceWorker] Pre-caching offline assets');
            return Promise.allSettled(ASSETS_TO_CACHE.map(asset => cache.add(asset)));
        }).then(() => self.skipWaiting())
    );
});

// Activate Event
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        console.log('[ServiceWorker] Clearing old cache:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch Event - Cache First with Network Fallback
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                // Return cached asset, update in background if online
                fetch(event.request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, networkResponse.clone());
                        });
                    }
                }).catch(() => {/* Offline fallback */});

                return cachedResponse;
            }

            return fetch(event.request).then((networkResponse) => {
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                    return networkResponse;
                }

                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });

                return networkResponse;
            }).catch(() => {
                if (event.request.mode === 'navigate') return caches.match('./index.html');
                throw new Error('Offline and asset is not cached');
            });
        })
    );
});

// Push Notification Handling
self.addEventListener('push', (event) => {
    const data = event.data ? event.data.json() : {};
    const title = data.title || '⏰ Nizhal Thunai Reminder';
    const options = {
        body: data.body || 'You have an upcoming note or task reminder!',
        icon: 'https://www.gstatic.com/labs-code/stitch/favicon-192x192.png',
        badge: 'https://www.gstatic.com/labs-code/stitch/favicon-48x48.png',
        vibrate: [200, 100, 200]
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});
