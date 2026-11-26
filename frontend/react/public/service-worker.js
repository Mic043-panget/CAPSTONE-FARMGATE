const CACHE_NAME = 'farmgate-pwa-v2';

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        const shellResponse = await fetch('/');
        if (!shellResponse.ok) {
            throw new Error(`Failed to precache app shell: ${shellResponse.status}`);
        }

        const shellHtml = await shellResponse.clone().text();
        await cache.put('/', shellResponse);

        const shellAssets = [...shellHtml.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)]
            .map(([, asset]) => asset);
        const manifestResponse = await fetch('/asset-manifest.json');
        if (!manifestResponse.ok) {
            throw new Error(`Failed to load build asset manifest: ${manifestResponse.status}`);
        }

        const buildManifest = await manifestResponse.json();
        const buildAssets = Object.values(buildManifest).flatMap((entry) => [
            entry.file,
            ...(entry.css ?? []),
            ...(entry.assets ?? []),
        ]).map((asset) => asset.startsWith('/') ? asset : `/${asset}`);
        await cache.addAll([
            '/manifest.webmanifest',
            '/favicon.svg',
            '/icons/icon-192.png',
            '/icons/icon-512.png',
            '/icons/icon-maskable-512.png',
            '/asset-manifest.json',
            ...new Set([...shellAssets, ...buildAssets]),
        ]);
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames
            .filter((name) => name.startsWith('farmgate-pwa-') && name !== CACHE_NAME)
            .map((name) => caches.delete(name)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        event.respondWith((async () => {
            try {
                const response = await fetch(request);
                if (response.ok) {
                    const cache = await caches.open(CACHE_NAME);
                    await cache.put('/', response.clone());
                }
                return response;
            } catch (error) {
                const cachedPage = await caches.match(request) ?? await caches.match('/');
                if (cachedPage) return cachedPage;
                throw error;
            }
        })());
        return;
    }

    if (url.pathname.startsWith('/assets/')) {
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            const cachedAsset = await cache.match(request);
            if (cachedAsset) return cachedAsset;

            const response = await fetch(request);
            if (response.ok) await cache.put(request, response.clone());
            return response;
        })());
    }
});

self.addEventListener('push', (event) => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch {
        payload = { title: 'Farmgate update', body: 'There is a new update in your account.' };
    }
    payload = payload.data && typeof payload.data === 'object' ? payload.data : payload;

    const title = typeof payload.title === 'string' ? payload.title : 'Farmgate update';
    const options = {
        body: typeof payload.body === 'string' ? payload.body : 'There is a new update in your account.',
        tag: typeof payload.notification_id === 'string' ? payload.notification_id : undefined,
        data: { url: typeof payload.url === 'string' ? payload.url : '/#notifications' },
        icon: '/favicon.svg',
        badge: '/favicon.svg',
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = new URL(event.notification.data?.url ?? '/#notifications', self.location.origin);
    if (target.origin !== self.location.origin) return;

    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windows) {
            if (client.url.startsWith(self.location.origin) && 'focus' in client) {
                await client.navigate(target.href);
                return client.focus();
            }
        }

        return self.clients.openWindow(target.href);
    })());
});
