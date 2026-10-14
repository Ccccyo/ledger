/* Generated with a build-specific manifest. Never cache API or account data. */
const manifest = __LIFE_LEDGER_MANIFEST__;
const cacheName = `life-ledger-shell-${manifest.version}`;
const pages = new Set(['/', '/en', '/zh', '/plan', '/en/plan', '/zh/plan']);
const origin = self.location.origin;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);
      try {
        const assets = new Set(manifest.assets);
        for (const page of pages) {
          // Public shell only: no cookies, authorization or user input in URLs.
          const response = await fetch(
            new Request(page, { credentials: 'omit', cache: 'reload' })
          );
          if (
            !response.ok ||
            !response.headers.get('content-type')?.includes('text/html')
          ) {
            throw new Error('Offline shell unavailable');
          }
          const html = await response.clone().text();
          for (const match of html.matchAll(/(?:src|href)="([^"<>]+)"/g)) {
            const url = new URL(match[1].replaceAll('&amp;', '&'), origin);
            if (
              url.origin === origin &&
              url.pathname.startsWith('/_next/static/')
            )
              assets.add(url.pathname);
          }
          await cache.put(page, response);
        }
        await Promise.all(
          [...assets].map(async (url) => {
            const response = await fetch(
              new Request(url, { credentials: 'omit', cache: 'reload' })
            );
            if (!response.ok) throw new Error('Offline asset unavailable');
            await cache.put(url, response);
          })
        );
      } catch (error) {
        await caches.delete(cacheName);
        throw error;
      }
    })()
  );
  // Do not skipWaiting: an existing tab must retain its matching build assets.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // Keep one preceding build for a navigation that received its HTML just
      // before controller handover. Its hashed scripts may arrive afterwards.
      const previous = keys
        .filter(
          (key) => key.startsWith('life-ledger-shell-') && key !== cacheName
        )
        .at(-1);
      await Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith('life-ledger-shell-') &&
              key !== cacheName &&
              key !== previous
          )
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== origin) return;
  if (request.mode === 'navigate' && pages.has(url.pathname)) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) return response;
        } catch {
          /* Use the prepared public shell, never a cached user response. */
        }
        const cache = await caches.open(cacheName);
        return (await cache.match(url.pathname)) || Response.error();
      })()
    );
  } else if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(cacheName);
        const current = await cache.match(url.pathname);
        if (current) return current;
        // Only immutable public build assets can fall back across versions.
        // Never match HTML, APIs, or unrelated application caches here.
        const keys = await caches.keys();
        for (const key of keys.reverse()) {
          if (!key.startsWith('life-ledger-shell-') || key === cacheName)
            continue;
          const previous = await (await caches.open(key)).match(url.pathname);
          if (previous) return previous;
        }
        return fetch(request);
      })()
    );
  }
});
