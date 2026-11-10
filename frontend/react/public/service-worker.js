self.addEventListener('push', (event) => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch {
        payload = { title: 'Farmgate update', body: 'There is a new update in your account.' };
    }

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
