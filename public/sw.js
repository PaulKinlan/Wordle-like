// Service worker: makes the app installable and open offline.
// - App shell (HTML, hashed JS/CSS, icons): cached, refreshed in the background.
// - API: always from the network, except the word list, which is cached so
//   guesses can be checked instantly.
// Bump VERSION to drop old caches.
const VERSION = 'v3';
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;
const PRECACHE = ['/', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL && k !== DATA && k !== 'prefs').map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    if (/^\/api\/v1\/[^/]+\/words$/.test(url.pathname)) event.respondWith(staleWhileRevalidate(req, DATA));
    return; // everything else: network only
  }

  if (req.mode === 'navigate') {
    // Network first so a new deploy shows up straight away; cached when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  event.respondWith(staleWhileRevalidate(req, SHELL));
});

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || network;
}

// Daily reminder (sent by the Worker's hourly cron, see worker/push.ts).
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Letterle', {
      body: data.body || "Today's word is ready",
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // A big picture under the text, where supported (Chrome on Android,
      // Windows and ChromeOS). Others just ignore it.
      image: data.image || '/og.png',
      tag: data.tag || 'daily',
      data: { url: data.url || '/' },
    }),
  );
});

// Tapping the notification opens the game, or focuses it if it's open.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});

// The browser can rotate a subscription; keep the server's copy current.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const res = await fetch('/api/v1/push/key');
      if (!res.ok) return;
      const { publicKey } = await res.json();
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });
      const prefs = (await caches.open('prefs').then((c) => c.match('/push-prefs')).then((r) => r?.json())) || {};
      await fetch('/api/v1/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), ...prefs }),
      });
    })(),
  );
});
