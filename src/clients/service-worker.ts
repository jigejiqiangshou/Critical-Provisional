/// <reference lib="webworker" />

import { frontendEntryMatches, frontendEntryPath, isFrontendEntryToken, readVerifiedFrontendEntry } from './frontend-entry'

interface ShellBuild {
  version: string
  assets: [path: string, integrity: string][]
}

// vite.config.ts replaces the marker with the contents of this exact host build.
const build: ShellBuild = JSON.parse('__CRITICAL_HOST_BUILD_MANIFEST__')
const worker = self as unknown as ServiceWorkerGlobalScope
const scope = new URL(worker.registration.scope)
const shellPrefix = 'critical-host:' + scope.href + ':'
const shellCacheName = shellPrefix + build.version
const shellAssets = new Map(build.assets.map(([path, integrity]) => [new URL(path, scope).href, integrity]))
const indexUrl = new URL('index.html', scope)
const installRecord = new URL('__critical__/shell-install', scope)
const entryPath = new URL(frontendEntryPath, scope).pathname

interface PreparedNavigation {
  readonly key: string
  readonly candidate: boolean
  used: boolean
  finish(served: boolean): void
}

const frontendNavigations = new Map<string, PreparedNavigation>()
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
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function hostAssetRequest(url: string, integrity: string): Request {
  return new Request(url, { cache: 'reload', redirect: 'error', credentials: 'same-origin', integrity })
}

async function hasCompleteShell(): Promise<boolean> {
  if (!await caches.match(installRecord, { cacheName: shellCacheName })) return false
  const present = await Promise.all([...shellAssets.keys()].map(url => caches.match(url, { cacheName: shellCacheName })))
  return present.every(Boolean)
}

async function installShell() {
  if (await hasCompleteShell()) return
  const previousShells = (await caches.keys()).filter(name => name.startsWith(shellPrefix) && name !== shellCacheName)
  const cache = await caches.open(shellCacheName)
  try {
    await cache.addAll([...shellAssets].map(([url, integrity]) => hostAssetRequest(url, integrity)))
    // A waiting worker retains the older active worker's resources until it can activate.
    await cache.put(installRecord, Response.json(previousShells))
  } catch (error) {
    await caches.delete(shellCacheName)
    throw error
  }
}

async function activateShell() {
  await worker.clients.claim()
  const record = await caches.match(installRecord, { cacheName: shellCacheName })
  const previousShells: string[] = record ? await record.json() : []
  const obsolete = previousShells.filter(name => name.startsWith(shellPrefix) && name !== shellCacheName)
  await Promise.all(obsolete.map(name => caches.delete(name)))
}

async function fetchShell(url: string, integrity: string): Promise<Response> {
  const cached = await caches.match(url, { cacheName: shellCacheName })
  if (cached) return cached

  // Repair an evicted asset only if the origin still has this build's exact bytes.
  try {
    const response = await fetch(hostAssetRequest(url, integrity))
    if (response.ok) {
      try {
        const cache = await caches.open(shellCacheName)
        await cache.put(url, response.clone())
      } catch {
        // Quota failure leaves the shell incomplete, but verified online content remains usable.
      }
      return response
    }
  } catch {
    // Retrieval is unavailable or the origin has moved to a different build.
  }
  return new Response('主体资源不可用', { status: 503 })
}

function missingEntry(): Response {
  return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
}

async function serveFrontendEntry(request: Request, url: URL): Promise<Response> {
  const key = url.searchParams.get('key')
  const instance = url.searchParams.get('instance')
  if (
    request.method !== 'GET' || request.destination !== 'iframe' || url.searchParams.size !== 2 ||
    !isFrontendEntryToken(key) || !isFrontendEntryToken(instance)
  ) return missingEntry()

  const navigation = frontendNavigations.get(instance)
  if (navigation && (navigation.key !== key || navigation.used)) return missingEntry()
  if (navigation) navigation.used = true

  try {
    const entry = await readVerifiedFrontendEntry(scope, key)
    if (!frontendEntryMatches(entry, key, instance)) return missingEntry()
    const candidate = entry.stageInstance !== undefined
    // Older shell records have neither package identity nor a staged instance.
    if (!navigation && (entry.packageId !== undefined || candidate)) return missingEntry()
    if (navigation && (frontendNavigations.get(instance) !== navigation || navigation.candidate !== candidate)) {
      return missingEntry()
    }
    const response = new Response(entry.html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': entryCsp,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    })
    navigation?.finish(true)
    return response
  } catch {
    return missingEntry()
  } finally {
    navigation?.finish(false)
  }
}

worker.addEventListener('install', event => event.waitUntil(installShell()))
worker.addEventListener('activate', event => event.waitUntil(activateShell()))
worker.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)
  if (url.origin !== scope.origin) return
  if (url.pathname === entryPath) {
    event.respondWith(serveFrontendEntry(request, url))
    return
  }
  if (request.destination === 'iframe') {
    event.respondWith(missingEntry())
    return
  }
  if (request.method !== 'GET') return

  const shellUrl = request.mode === 'navigate' && (url.pathname === scope.pathname || url.pathname === indexUrl.pathname)
    ? indexUrl.href
    : url.href
  const integrity = shellAssets.get(shellUrl)
  if (integrity) event.respondWith(fetchShell(shellUrl, integrity))
})

async function prepareFrontendEntry(event: ExtendableMessageEvent, port: MessagePort): Promise<void> {
  const { source, data } = event
  const { key, instance, candidate } = data
  if (
    !source || !('frameType' in source) || source.type !== 'window' || source.frameType === 'nested' ||
    !source.url.startsWith(scope.href) || !isFrontendEntryToken(key) || !isFrontendEntryToken(instance) ||
    typeof candidate !== 'boolean' || frontendNavigations.has(instance)
  ) {
    port.postMessage({ type: 'served', ready: false })
    return
  }

  await new Promise<void>(resolve => {
    const navigation: PreparedNavigation = {
      key,
      candidate,
      used: false,
      finish: served => {
        if (frontendNavigations.get(instance) !== navigation) return
        frontendNavigations.delete(instance)
        clearTimeout(timer)
        try { port.postMessage({ type: 'served', ready: served }) } finally { resolve() }
      },
    }
    const timer = setTimeout(() => navigation.finish(false), 30_000)
    frontendNavigations.set(instance, navigation)
    port.addEventListener('close', () => navigation.finish(false))
    port.onmessage = () => navigation.finish(false)
    port.postMessage({ type: 'prepared' })
  })
}

worker.addEventListener('message', event => {
  const port = event.ports[0]
  if (!port) return
  if (event.data?.type === 'critical.frontend-entry-prepare') {
    event.waitUntil(prepareFrontendEntry(event, port).finally(() => port.close()))
    return
  }
  if (event.data?.type !== 'critical.host-cache-status') return
  event.waitUntil(hasCompleteShell().then(
    complete => port.postMessage({ version: build.version, complete }),
    () => port.postMessage({ version: build.version, complete: false }),
  ).finally(() => port.close()))
})
