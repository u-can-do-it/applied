// Jobwatch's service worker (registered by features/shell/service-worker.tsx). It shows push
// notifications (lib/push.ts sends them: { title, body, url }) and opens the app where one points
// when it's tapped. No fetch handler: nothing is cached, every page comes from the server as before.

self.addEventListener('install', () => {
  self.skipWaiting(); // a new version takes over at once; it holds no cache an old page could need
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Jobwatch';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png', // Android's status bar: the shape only
      data: { url: typeof data.url === 'string' ? data.url : '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // only a page of this app, whatever the message said
  let target = new URL('/', self.location.origin);
  try {
    const url = event.notification.data?.url;
    const wanted = new URL(typeof url === 'string' ? url : '/', self.location.origin);
    if (wanted.origin === self.location.origin) target = wanted;
  } catch {
    // not a URL: the start page
  }
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // the app already open (the installed one, or a tab): there, on that page
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        const focused = await open.focus();
        try {
          await (focused ?? open).navigate(target.href);
          return;
        } catch {
          // a page this worker doesn't control yet can't be navigated: open a new one
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
