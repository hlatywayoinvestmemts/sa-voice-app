'use strict';
// Bump VERSION for EVERY release that changes the static shell.
const VERSION = 'v1.3.7';
const CACHE = 'sa-voice-shell-' + VERSION;
const SHELL = ['./', './index.html', './app.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
self.addEventListener('install', event => {
  // Versioned requests avoid a stale CDN shell during a Pages rollout.
  event.waitUntil(caches.open(CACHE).then(cache => Promise.all(SHELL.map(async path => {
    const url = new URL(path, self.registration.scope);
    const fresh = new URL(url);
    fresh.searchParams.set('release', VERSION);
    const response = await fetch(fresh, { cache: 'reload' });
    if (!response.ok) throw new Error('Shell download failed');
    await cache.put(url, response);
  }))));
  // No skipWaiting: do not replace code during an active recording or text edit.
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('sa-voice-shell-') && key !== CACHE)
      .map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const allowed = SHELL.map(path => new URL(path, self.registration.scope).href);
  // Cache only our exact static shell. Never cache audio, uploads or API requests.
  if (url.origin !== self.location.origin || !allowed.includes(url.href)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(event.request);
    // Revalidate HTML and code on launch, with a bounded offline fallback.
    // Never cache API requests or user content; do not force a running tab to reload.
    if (event.request.mode === 'navigate' || url.pathname.endsWith('/app.js')) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      try {
        const fresh = await fetch(event.request, {cache:'no-cache', signal:controller.signal});
        if (fresh.ok) { await cache.put(event.request, fresh.clone()); return fresh; }
        if (!cached) return fresh;
      } catch (error) { if (!cached) throw error; }
      finally { clearTimeout(timer); }
    }
    return cached || fetch(event.request);
  }));
});
