const scope = self.registration.scope
const shellAssets = /* BUILD_ASSETS */ []
const shellUrls = new Set(shellAssets.map(path => new URL(path, scope).href))
const shellCacheName = 'critical-t004-shell-v1'
const packageCacheName = 'critical-t004-packages-v1'
const entryPath = new URL('__t004__/entry', scope).pathname
const navigationProbe = new URL('navigation-target.html', scope).href
const packageIds = new Set(['critical.probe.official-3d', 'third.party.frontend-probe'])
const entryCsp = [
  "sandbox allow-scripts",
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  'media-src data:',
  "connect-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

self.addEventListener('install', event => {
  event.waitUntil(caches.open(shellCacheName).then(cache => cache.addAll([...shellUrls])))
})
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin === self.location.origin && url.pathname === entryPath) {
    event.respondWith(serveEntry(request, url))
  } else if (url.origin === self.location.origin && request.destination === 'iframe') {
    event.respondWith(serveNavigationProbe(url))
  } else if (shellUrls.has(url.href)) {
    event.respondWith(caches.open(shellCacheName).then(async cache => await cache.match(request) ?? fetch(request)))
  }
})

async function serveEntry(request, url) {
  const id = url.searchParams.get('id')
  const mark = url.searchParams.get('instance') ?? ''
  if (request.destination !== 'iframe' || !packageIds.has(id) || !/^[0-9a-f-]{36}$/.test(mark)) {
    return new Response(null, { status: 404 })
  }
  const cache = await caches.open(packageCacheName)
  const candidate = await cache.match(new URL(`__t004__/stored/${id}`, scope))
  if (!candidate) return new Response(null, { status: 404 })
  return sandboxedHtml(candidate.body)
}

async function serveNavigationProbe(url) {
  if (url.href !== navigationProbe) return new Response(null, { status: 404 })
  const cache = await caches.open(shellCacheName)
  const target = await cache.match(url)
  return target ? sandboxedHtml(target.body) : new Response(null, { status: 404 })
}

function sandboxedHtml(body) {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': entryCsp,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  })
}
