import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { build } from 'vite'
import type { getOfflineReadiness } from '../../src/clients/offline-ready'

const status = '#offline-status'
const buildMeta = 'meta[name="critical-host-build"]'
const packageRoute = '__critical__/frontend-entry'
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
}

type ProbeWindow = Window & { getOfflineReadiness: typeof getOfflineReadiness }

test('ships one versioned, integrity-checked shell from the normal build', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.locator(status)).toHaveAttribute('data-state', 'initial-release-pending')
  const version = await page.locator(buildMeta).getAttribute('content')
  expect(version).toMatch(/^[a-f0-9]{64}$/)
  const record = await page.evaluate(async () => {
    const keys = await caches.keys()
    const cacheName = keys.find(key => key.endsWith(document.querySelector<HTMLMetaElement>('meta[name="critical-host-build"]')!.content))
    if (!cacheName) throw new Error('Active shell cache not found')
    const cache = await caches.open(cacheName)
    const urls = (await cache.keys()).map(item => item.url)
    return { cacheName, urls }
  })
  expect(record.urls.map(url => new URL(url).pathname)).toEqual(expect.arrayContaining([
    '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png',
  ]))
  expect(record.urls.some(url => new URL(url).pathname.startsWith('/assets/'))).toBe(true)
  expect(record.urls.some(url => url.endsWith('.critical-ui'))).toBe(false)
  for (const url of record.urls.filter(url => !new URL(url).pathname.startsWith('/__critical__/'))) {
    const hash = createHash('sha256').update(await (await request.get(url)).body()).digest('hex')
    const cachedHash = await page.evaluate(async ({ cacheName, url }) => {
      const response = await (await caches.open(cacheName)).match(url)
      if (!response) throw new Error(`Asset ${url} is missing`)
      const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer())
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    }, { cacheName: record.cacheName, url })
    expect(cachedHash).toBe(hash)
  }
  const sourceFallback = await request.get(`/${packageRoute}?key=${randomUUID()}&instance=${randomUUID()}`)
  expect(sourceFallback.status()).toBe(404)
  expect(await sourceFallback.text()).not.toMatch(/<script|<!doctype|critical-host-build/i)
})

type Variant = 'original' | 'missing' | 'corrupt' | 'updated'

async function buildVariant(outDir: string, variant: Variant) {
  await build({
    configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
    logLevel: 'error',
    build: { outDir, emptyOutDir: true },
    plugins: [{
      name: 'offline-shell-test-probe',
      transformIndexHtml: {
        order: 'pre',
        handler: () => [
          { tag: 'meta', attrs: { name: 'test-version', content: variant }, injectTo: 'head' },
          { tag: 'script', attrs: { type: 'module', src: '/tests/acceptance/fixtures/offline-readiness-probe.ts' }, injectTo: 'head' },
        ],
      },
    }],
  })
}

async function serveVersions(directories: Record<Variant, string>) {
  let current: Variant = 'original'
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const path = pathname === '/' ? 'index.html' : pathname.slice(1)
    const directory = resolve(directories[current])
    const file = resolve(directory, path)
    if (!file.startsWith(directory + sep) || (current === 'missing' && path === 'icon-192.png')) {
      response.writeHead(404).end()
      return
    }
    try {
      let content = await readFile(file)
      if (current === 'corrupt' && path === 'icon-192.png') content = Buffer.from('corrupted asset')
      response.writeHead(200, {
        'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      }).end(content)
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise<void>((done, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', done)
  })
  const binding = server.address()
  if (!binding || typeof binding === 'string') throw new Error('Missing static test server address')
  return {
    url: `http://127.0.0.1:${binding.port}/`,
    switchTo: (variant: typeof current) => { current = variant },
    stop: () => new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())),
  }
}

async function installPwa(context: BrowserContext, url: string) {
  const session = await context.browser()!.newBrowserCDPSession()
  try {
    await session.send('PWA.install', { manifestId: url, installUrlOrBundleUrl: url })
    await session.send('PWA.changeAppUserSettings', { manifestId: url, displayMode: 'standalone' })
  } finally {
    await session.detach()
  }
}

async function openInstalledPwa(context: BrowserContext, url: string): Promise<Page> {
  const session = await context.browser()!.newBrowserCDPSession()
  const opened = context.waitForEvent('page')
  try {
    await session.send('PWA.launch', { manifestId: url })
    const page = await opened
    await page.waitForLoadState('domcontentloaded')
    expect(await page.evaluate(() => matchMedia('(display-mode: standalone)').matches)).toBe(true)
    return page
  } finally {
    await session.detach()
  }
}

async function nextWorkerState(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) throw new Error('Expected an existing worker registration')
    const changed = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker update did not report an installation state')), 10_000)
      registration.addEventListener('updatefound', () => {
        const candidate = registration.installing
        if (!candidate) return
        const observe = () => {
          if (candidate.state !== 'installed' && candidate.state !== 'redundant') return
          clearTimeout(timeout)
          candidate.removeEventListener('statechange', observe)
          resolve(candidate.state)
        }
        candidate.addEventListener('statechange', observe)
        observe()
      }, { once: true })
    })
    await registration.update()
    return changed
  })
}

async function seedInstalledEntry(page: Page, key: string) {
  // T018's publisher is outside this slice. Seed one trusted record in the shared store.
  await page.evaluate(async ({ key, scope }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('critical-frontend-installations:' + scope, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('entries', { keyPath: 'key' })
        request.result.createObjectStore('installations', { keyPath: 'key' })
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(['entries', 'installations'], 'readwrite')
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(tx.error)
        tx.objectStore('installations').add({ key: 'example.compatible', version: '1.0.0', entryKey: key })
        tx.objectStore('entries').add({ key, html: `<!doctype html><title>Compatible UI 1.0.0</title>
          <script>
            (async () => {
              let parentBlocked = false, storageBlocked = false, networkBlocked = false
              try { void parent.document.title } catch { parentBlocked = true }
              try { localStorage.setItem('isolation-check', 'forbidden') } catch { storageBlocked = true }
              try { await fetch('/index.html') } catch { networkBlocked = true }
              parent.postMessage({ type: 'offline-shell-probe', version: '1.0.0', instance: new URL(location.href).searchParams.get('instance'), parentBlocked, storageBlocked, networkBlocked }, '*')
            })()
          </script>` })
      })
    } finally {
      database.close()
    }
  }, { key, scope: new URL(page.url()).pathname })
}

async function openCompatiblePackage(page: Page, key: string) {
  const instance = randomUUID()
  const url = new URL(`${packageRoute}?key=${key}&instance=${instance}`, page.url()).href
  const response = page.waitForResponse(result => result.url() === url)
  const message = await page.evaluate(({ url }) => new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    const timeout = setTimeout(() => {
      window.removeEventListener('message', receive)
      reject(new Error('The compatible package did not finish its startup probe'))
    }, 6_000)
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.type !== 'offline-shell-probe') return
      clearTimeout(timeout)
      window.removeEventListener('message', receive)
      resolve({ origin: event.origin, ...event.data })
    }
    window.addEventListener('message', receive)
    frame.src = url
    // Begin navigation from the host origin. The response's CSP makes the instance opaque.
    document.body.append(frame)
  }), { url })
  const documentResponse = await response
  expect(documentResponse.status()).toBe(200)
  expect(documentResponse.fromServiceWorker()).toBe(true)
  const headers = await documentResponse.allHeaders()
  expect(headers['content-security-policy']).toContain('sandbox allow-scripts')
  expect(headers['content-security-policy']).toContain("connect-src 'none'")
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(message).toEqual({ origin: 'null', type: 'offline-shell-probe', version: '1.0.0', instance,
    parentBlocked: true, storageBlocked: true, networkBlocked: true })
}

test('preserves a usable shell during failed upgrades and reopens the installed package after a real offline restart', async () => {
  test.setTimeout(75_000)
  const temporary = await mkdtemp(join(tmpdir(), 'critical-offline-shell-'))
  const directories = {
    original: join(temporary, 'original'),
    missing: join(temporary, 'missing'),
    corrupt: join(temporary, 'corrupt'),
    updated: join(temporary, 'updated'),
  }
  const profile = join(temporary, 'chromium')
  let server: Awaited<ReturnType<typeof serveVersions>> | undefined
  let context: BrowserContext | undefined
  const launch = (offline = false) => chromium.launchPersistentContext(profile, {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    offline,
  })

  try {
    for (const variant of ['original', 'missing', 'corrupt', 'updated'] as const) {
      await buildVariant(directories[variant], variant)
    }
    server = await serveVersions(directories)
    const url = server.url
    context = await launch()
    const installer = context.pages()[0]
    await installer.goto(url)
    await expect(installer.locator(status)).toHaveAttribute('data-state', 'initial-release-pending')
    const originalVersion = await installer.locator(buildMeta).getAttribute('content')
    expect(originalVersion).toMatch(/^[a-f0-9]{64}$/)

    const readiness = await installer.evaluate(async () => {
      const read = (window as unknown as ProbeWindow).getOfflineReadiness
      return [await read(), await read(async () => false), await read(async () => true), await read(async () => {
        throw new Error('catalog unavailable')
      })]
    })
    expect(readiness).toEqual([
      { ready: false, reason: 'initial-release-pending' },
      { ready: false, reason: 'initial-release-pending' },
      { ready: true, version: originalVersion },
      { ready: false, reason: 'initial-release-unavailable' },
    ])
    const mismatch = await installer.evaluate(async () => {
      const meta = document.querySelector<HTMLMetaElement>('meta[name="critical-host-build"]')!
      const original = meta.content
      meta.content = 'different-build'
      try {
        return await (window as unknown as ProbeWindow).getOfflineReadiness(async () => true)
      } finally {
        meta.content = original
      }
    })
    expect(mismatch).toEqual({ ready: false, reason: 'host-version-mismatch' })

    const key = randomUUID()
    await seedInstalledEntry(installer, key)
    await installPwa(context, url)
    const active = await openInstalledPwa(context, url)
    await installer.close()
    await openCompatiblePackage(active, key)
    const directUrl = new URL(`${packageRoute}?key=${key}&instance=${randomUUID()}`, url).href
    const direct = await active.evaluate(async href => {
      const response = await fetch(href)
      return { status: response.status, body: await response.text() }
    }, directUrl)
    expect(direct).toEqual({ status: 404, body: '' })
    const missingEntryUrl = new URL(`${packageRoute}?key=${randomUUID()}&instance=${randomUUID()}`, url).href
    const missingResponse = active.waitForResponse(response => response.url() === missingEntryUrl)
    await active.evaluate((src) => {
      const frame = document.createElement('iframe')
      frame.src = src
      document.body.append(frame)
    }, missingEntryUrl)
    const missing = await missingResponse
    expect(missing.status()).toBe(404)
    expect(missing.fromServiceWorker()).toBe(true)
    expect(await missing.text()).toBe('')

    for (const failedVariant of ['missing', 'corrupt'] as const) {
      // Chromium skips an update when the worker bytes match the last failed candidate.
      // Use independently built variants so both defects reach the install handler.
      server.switchTo(failedVariant)
      expect(await nextWorkerState(active)).toBe('redundant')
      await active.reload()
      await expect(active.locator(buildMeta)).toHaveAttribute('content', originalVersion!)
      await expect(active.locator(status)).toHaveAttribute('data-state', 'initial-release-pending')
      await openCompatiblePackage(active, key)
    }

    server.switchTo('updated')
    expect(await nextWorkerState(active)).toBe('installed')
    await expect(active.locator(buildMeta)).toHaveAttribute('content', originalVersion!)
    await openCompatiblePackage(active, key)
    await context.close()
    context = await launch()
    const upgraded = await openInstalledPwa(context, url)
    await expect(upgraded.locator('meta[name="test-version"]')).toHaveAttribute('content', 'updated')
    const upgradedVersion = await upgraded.locator(buildMeta).getAttribute('content')
    expect(upgradedVersion).toMatch(/^[a-f0-9]{64}$/)
    expect(upgradedVersion).not.toBe(originalVersion)
    await expect(upgraded.locator(status)).toHaveAttribute('data-state', 'initial-release-pending')
    await openCompatiblePackage(upgraded, key)

    await context.close()
    await server.stop()
    server = undefined
    await expect(fetch(url)).rejects.toThrow()
    context = await launch(true)
    const cold = await openInstalledPwa(context, url)
    expect(await cold.evaluate(() => navigator.onLine)).toBe(false)
    await expect(cold.locator(buildMeta)).toHaveAttribute('content', upgradedVersion!)
    await expect(cold.locator(status)).toHaveAttribute('data-state', 'initial-release-pending')
    await openCompatiblePackage(cold, key)
    const lostAsset = await cold.evaluate(async () => {
      const match = (await caches.keys()).find(key => key.endsWith(document.querySelector<HTMLMetaElement>('meta[name="critical-host-build"]')!.content))
      if (!match) throw new Error('No active cache to test independent cache loss')
      return (await caches.open(match)).delete(new URL('icon-192.png', location.href))
    })
    expect(lostAsset).toBe(true)
    expect(await cold.evaluate(() => (window as unknown as ProbeWindow).getOfflineReadiness(async () => true))).toEqual({
      ready: false, reason: 'host-cache-incomplete',
    })
  } finally {
    await context?.close()
    await server?.stop()
    await rm(temporary, { recursive: true, force: true })
  }
})
