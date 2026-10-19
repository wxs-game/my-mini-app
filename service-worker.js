// Service Worker для мгновенного обновления без кэша
const CACHE_NAME = 'wxs-game-' + Date.now();

self.addEventListener('install', (event) => {
    // Пропускаем ожидание и активируемся сразу
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Удаляем все старые кэши
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            // Берём контроль над всеми страницами
            return self.clients.claim();
        })
    );
});

self.addEventListener('fetch', (event) => {
    // Всегда загружаем с сервера, игнорируем кэш
    event.respondWith(
        fetch(event.request.clone(), {
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }
        }).catch(() => {
            // Если сеть недоступна, пробуем кэш
            return caches.match(event.request);
        })
    );
});
