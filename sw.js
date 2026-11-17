'use strict';
// Bump VERSION for EVERY release that changes the static shell.
const VERSION = 'v1.1.0';
const CACHE = 'sa-voice-shell-' + VERSION;
const SHELL = ['./', './index.html', './app.js', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
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
    return cached || fetch(event.request);
  }));
});
