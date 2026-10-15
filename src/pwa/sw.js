// Only build-produced, public assets belong in Cache Storage. Account data stays in IndexedDB.
const manifest = self.__WB_MANIFEST
const prefix = 'ny-volako-shell-'
const version = manifest.map(entry => `${entry.url}:${entry.revision}`).join('|')
const cacheName = crypto.subtle.digest('SHA-256', new TextEncoder().encode(version))
  .then(bytes => prefix + Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join(''))
const assets = new Set(manifest.map(entry => new URL(entry.url, self.registration.scope).href))
const indexUrl = new URL('index.html', self.registration.scope).href
const appRoute = /^\/(?:|index\.html|configuration|installation|connexion|inscription|mot-de-passe-oublie|recuperation|compte|tableau-de-bord|depenses(?:\/[^/]+)?|categories|budgets|synchronisation)$/

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const name = await cacheName
    const existed = (await caches.keys()).includes(name)
    const cache = await caches.open(name)
    // addAll is atomic: a failed resource leaves the previous worker active.
    try {
      await cache.addAll([...assets].map(url => new Request(url, { cache: 'reload', credentials: 'same-origin' })))
    } catch (error) {
      if (!existed) await caches.delete(name)
      throw error
    }
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const current = await cacheName
    const previous = (await caches.keys()).filter(key => key.startsWith(prefix) && key !== current)
    // Keep the previous shell for an old window opened during the activation handshake.
    await Promise.all(previous.slice(0, -1).map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  const navigation = event.request.mode === 'navigate' && appRoute.test(url.pathname)
  // Ignore query-bearing asset requests; never store URL tokens or API responses.
  const oldAsset = /^\/assets\/[^/]+\.(?:js|css)$/.test(url.pathname) && !url.search
  if (!navigation && (!assets.has(url.href) || url.search) && !oldAsset) return
  event.respondWith((async () => {
    const cache = await caches.open(await cacheName)
    // Static resources are identical for every visitor; Origin/Vary must not turn
    // a module request into a cache miss after a no-Origin precache fetch.
    const response = await cache.match(navigation ? indexUrl : event.request, { ignoreVary: true })
    if (response) return response
    if (oldAsset) {
      for (const name of (await caches.keys()).filter(key => key.startsWith(prefix))) {
        const previous = await (await caches.open(name)).match(event.request, { ignoreVary: true })
        if (previous) return previous
      }
    }
    return fetch(event.request)
  })())
})

self.addEventListener('message', event => {
  if (event.data?.type !== 'ACTIVATE_SAFELY' || !event.ports[0]) return
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const ownWindows = windows.filter(client => client.url.startsWith(self.registration.scope))
    const allowed = ownWindows.length === 1 && ownWindows[0].id === event.source?.id
    event.ports[0].postMessage({ allowed })
    if (allowed) await self.skipWaiting()
  })())
})
