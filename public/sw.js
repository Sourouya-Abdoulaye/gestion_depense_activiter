/* ---------------------------------------------------------------------------
 * Mon Commerce — Service Worker
 * Objectif : permettre l'ouverture de l'application hors connexion après un
 * premier chargement réussi. Aucune donnée métier ne transite ici : les
 * données du commerce restent dans IndexedDB sur cet appareil.
 * ------------------------------------------------------------------------- */

const CACHE_VERSION = 'mon-commerce-v3';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // addAll échoue si une seule ressource manque : on tolère les absences.
      await Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)));
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.disable();
      }
      await self.clients.claim();
    })(),
  );
});

/** Mise en cache à la volée : la première visite remplit le cache. */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request, { ignoreSearch: false });
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    cache.put(request, response.clone()).catch(() => undefined);
  }
  return response;
}

/** Navigations : réseau d'abord, repli sur la page mise en cache. */
async function handleNavigation(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put('./index.html', response.clone()).catch(() => undefined);
    }
    return response;
  } catch {
    const cached =
      (await cache.match(request)) ||
      (await cache.match('./index.html')) ||
      (await cache.match('./'));
    if (cached) return cached;
    return new Response(
      '<!doctype html><html lang="fr"><meta charset="utf-8"><title>Hors ligne</title>' +
        '<body style="font-family:sans-serif;padding:24px"><h1>Hors ligne</h1>' +
        '<p>La page demandée n\'est pas encore disponible hors connexion. Reconnectez-vous puis rechargez une fois.</p></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  event.respondWith(
    cacheFirst(request).catch(
      () => new Response('', { status: 504, statusText: 'Ressource indisponible hors connexion' }),
    ),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  // Pré-cache des ressources réellement chargées (modules JS, styles, polices) :
  // améliore l'ouverture hors connexion dès la première visite (L20).
  if (event.data && event.data.type === 'CACHE_URLS' && Array.isArray(event.data.urls)) {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        await Promise.all(
          event.data.urls
            .filter((url) => typeof url === 'string' && url.startsWith(self.location.origin))
            .map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)),
        );
      })(),
    );
  }
});
