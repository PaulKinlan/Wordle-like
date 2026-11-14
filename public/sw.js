// Service worker: makes the app installable and open offline.
// - Pages: from the network if it answers within a few seconds, else the saved copy.
// - Hashed JS/CSS: from the cache. Icons and the rest: cached, refreshed in the background.
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
      // Navigation preload: on a page load the browser asks the network
      // straight away instead of waiting for this worker to start up.
      .then(() => self.registration.navigationPreload?.enable())
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
    event.respondWith(page(event, url));
    return;
  }

  // Built files have their contents in their names, so a saved copy is never out of date.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req, SHELL));
    return;
  }

  event.respondWith(staleWhileRevalidate(req, SHELL));
});

// How long a page load waits for the network before showing the saved copy.
const PAGE_WAIT_MS = 2500;

/**
 * A page: from the network, so a new deploy shows up straight away, but only
 * if it answers soon. On a weak signal the saved copy opens instead of a
 * blank screen (and at once when offline); the fresh page is still saved for
 * next time, and the app's own update check offers a reload.
 */
async function page(event, url) {
  const req = event.request;
  // Each page has its own copy (/, /es/, /fr/...): the language pages have their own <head>.
  const own = /^\/([a-z]{2}\/)?$/.test(url.pathname);
  const network = (async () => {
    // The browser starts this request while the service worker is still waking up (see activate).
    const res = (await event.preloadResponse) || (await fetch(req));
    if (res.ok && own) {
      const copy = res.clone();
      await caches.open(SHELL).then((c) => c.put(url.pathname, copy));
    }
    return res;
  })();
  // Keeps the worker alive until the fresh page is saved, even if the saved one was shown.
  event.waitUntil(network.catch(() => undefined));
  const saved = (await caches.match(url.pathname)) ?? (await caches.match('/'));
  if (!saved) return network;
  let timer;
  const tooSlow = new Promise((resolve) => (timer = setTimeout(resolve, PAGE_WAIT_MS)));
  try {
    return (await Promise.race([network, tooSlow])) ?? saved;
  } catch {
    return saved;
  } finally {
    clearTimeout(timer);
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

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
  if (data.kind !== 'race') self.navigator.setAppBadge?.().catch(() => undefined);
  event.waitUntil(
    self.registration.showNotification(data.title || 'Letterle', {
      body: data.body || "Today's word is ready",
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // A big picture under the text, where supported (Chrome on Android,
      // Windows and ChromeOS). Others just ignore it.
      image: data.image || '/og.png',
      tag: data.tag || 'daily',
      data: { url: data.url || '/', kind: data.kind || 'daily' },
      // "A friend joined": buzz even if an older one is still showing.
      renotify: data.kind === 'race',
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
  // "A friend joined your race": back to the app (it's already in the race), or open the invite link.
  if (event.notification.data?.kind === 'race') {
    const url = new URL(event.notification.data.url, self.location.origin).href;
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
        const client = list.find((c) => new URL(c.url).origin === self.location.origin && 'focus' in c);
        return client ? client.focus() : self.clients.openWindow(url);
      }),
    );
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
