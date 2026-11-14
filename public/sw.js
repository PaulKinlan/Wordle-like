// Service worker: makes the app installable and open offline.
// - App shell (HTML, hashed JS/CSS, icons): cached, refreshed in the background.
// - API: always from the network, except the word list, which is cached so
//   guesses can be checked instantly.
// Bump VERSION to drop old caches.
const VERSION = 'v7';
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
  // The dashboard and health check are always live, and never the app shell.
  if (url.pathname.startsWith('/dashboard') || url.pathname === '/health') return;

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
          // Each page has its own copy (/, /es/, /fr/...): the language pages have their own <head>.
          if (res.ok && /^\/([a-z]{2}\/)?$/.test(url.pathname)) caches.open(SHELL).then((c) => c.put(url.pathname, copy));
          return res;
        })
        .catch(async () => (await caches.match(url.pathname)) ?? caches.match('/')),
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
  // A dot on the app icon until today's word is played (Chrome, installed apps).
  self.navigator.setAppBadge?.().catch(() => undefined);
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
      // Buttons, where supported (Android shows the first two).
      actions: data.actions
        ? [
            { action: 'play', title: data.actions.play },
            { action: 'snooze', title: data.actions.snooze },
            { action: 'race', title: data.actions.race },
          ].slice(0, self.Notification?.maxActions ?? 3)
        : [],
    }),
  );
});

// Tapping the notification (or Play) opens today's word; Race opens the race
// lobby; Snooze asks the server to send it again in about an hour.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'snooze') {
    event.waitUntil(snooze());
    return;
  }
  const play = event.action === 'race' ? 'race' : 'daily';
  const url = new URL(`/?play=${play}`, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          client.postMessage({ type: 'play', play });
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

async function snooze() {
  const sub = await self.registration.pushManager.getSubscription();
  if (!sub) return;
  await fetch('/api/v1/push/snooze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => undefined);
}

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
