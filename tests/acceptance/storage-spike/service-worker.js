const cachePrefix = `critical-storage-spike:${self.registration.scope}:`
const cacheName = cachePrefix + __BUILD_HASH__
const files = __PRECACHE_FILES__
const urls = new Set(files.map((file) => new URL(file, self.registration.scope).href))
const indexUrl = new URL('index.html', self.registration.scope).href

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(
    [...urls].map((url) => new Request(url, { cache: 'reload' })),
  )))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const stale = (await caches.keys()).filter((key) => key.startsWith(cachePrefix) && key !== cacheName)
    await Promise.all(stale.map((key) => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = event.request.url === self.registration.scope ? indexUrl : event.request.url
  if (!urls.has(url)) return

  event.respondWith((async () => {
    const cache = await caches.open(cacheName)
    return await cache.match(url) ?? fetch(event.request)
  })())
})
