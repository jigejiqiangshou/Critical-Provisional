import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { build, preview } from 'vite'
import type { PreviewServer } from 'vite'
import { frontendInstallFile, frontendInstallPackages } from './fixtures/frontend-install-packages'
import { packageClient } from './install-fixture/client'

const samples = frontendInstallPackages(packageClient('1.0.0'), packageClient('1.1.0'))
const id = samples.initial.id
const mount = '#frontends iframe'
const initial = [[id, '1.0.0']]
const upgraded = [[id, '1.1.0']]
let temporary: string
let server: PreviewServer
let url: string

test.beforeAll(async () => {
  const root = fileURLToPath(new URL('../..', import.meta.url))
  const configFile = join(root, 'vite.config.ts')
  temporary = await mkdtemp(join(tmpdir(), 'critical-install-test-'))
  const config = { root, configFile, logLevel: 'error' as const, build: { outDir: join(temporary, 'dist') } }
  await build({
    ...config,
    plugins: [{
      name: 'installation-acceptance-probe',
      transformIndexHtml: {
        order: 'pre',
        handler: () => [{
          tag: 'script',
          attrs: { type: 'module', src: '/tests/acceptance/install-fixture/probe.ts' },
          injectTo: 'body',
        }],
      },
    }],
  })
  server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } })
  const binding = server.httpServer.address()
  if (!binding || typeof binding === 'string') throw new Error('Missing installation test preview address')
  url = `http://127.0.0.1:${binding.port}/`
})

test.afterAll(async () => {
  try {
    if (server) await new Promise<void>((done, reject) => server.httpServer.close(error => error ? reject(error) : done()))
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true })
  }
})

async function ready(page: Page) {
  await page.waitForFunction(() => Boolean(window.installProbe))
}

async function choosePackage(
  page: Page,
  pack: Parameters<typeof frontendInstallFile>[0],
  options: { id?: string; confirm?: boolean } = {},
) {
  await page.locator('#package-file').setInputFiles(frontendInstallFile(pack))
  return page.evaluate(({ id, confirm }) => window.installProbe.selected(id, confirm), options)
}

type Fault = Parameters<Window['installProbe']['setFault']>[0]

async function setFault(page: Page, fault: Fault = 'none') {
  await page.evaluate(value => window.installProbe.setFault(value), fault)
}

function expectError(result: unknown, code: string) {
  expect(result).toEqual({ error: expect.objectContaining({ code }) })
}

async function list(page: Page) {
  return page.evaluate(() => window.installProbe.list())
}

async function installPwa(context: BrowserContext) {
  const session = await context.browser()!.newBrowserCDPSession()
  try {
    await session.send('PWA.install', { manifestId: url, installUrlOrBundleUrl: url })
    await session.send('PWA.changeAppUserSettings', { manifestId: url, displayMode: 'standalone' })
  } finally {
    await session.detach()
  }
}

async function openInstalledPwa(context: BrowserContext) {
  const session = await context.browser()!.newBrowserCDPSession()
  const opened = context.waitForEvent('page')
  try {
    await session.send('PWA.launch', { manifestId: url })
    const page = await opened
    await page.waitForLoadState('domcontentloaded')
    expect(await page.evaluate(() => matchMedia('(display-mode: standalone)').matches)).toBe(true)
    await ready(page)
    return page
  } finally {
    await session.detach()
  }
}

test('publishes only after the candidate checks and keeps the old authorized match playable through an offline upgrade', async () => {
  test.setTimeout(60_000)
  const profile = join(temporary, 'installer-profile')
  const launch = { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined }
  let context = await chromium.launchPersistentContext(profile, launch)
  try {
    const seed = context.pages()[0]
    await seed.goto(url)
    await ready(seed)
    await installPwa(context)
    const page = await openInstalledPwa(context)
    await context.setOffline(true)

    await page.evaluate(() => window.installProbe.holdCommit())
    const pending = choosePackage(page, samples.initial)
    await expect.poll(() => page.evaluate(() => window.installProbe.isCommitWaiting())).toBe(true)
    expect(await list(page)).toEqual([])
    const candidate = page.frameLocator(mount)
    await expect(candidate.locator('#version')).toHaveText('1.0.0')
    await expect(candidate.locator('#state')).toHaveText('welcomed')
    await candidate.locator('#query').evaluate(button => (button as HTMLButtonElement).click())
    await expect(candidate.locator('#isolation')).toHaveText(JSON.stringify({
      hostDom: true, localStorage: true, indexedDb: true, opaqueOrigin: true,
    }))
    expect(await page.evaluate(() => window.installProbe.metrics())).toMatchObject({ queryProjectionCount: 0, confirmationCount: 0 })
    expect(await candidate.locator('#result').textContent()).not.toContain('original-decision')
    await page.evaluate(() => window.installProbe.releaseCommit())
    expect(await pending).toEqual({ version: '1.0.0' })
    expect(await list(page)).toEqual(initial)
    await expect(page.locator(mount)).toHaveCount(0)

    expect(await page.evaluate(packageId => window.installProbe.openCurrent(packageId), id)).toMatchObject({ version: '1.0.0' })
    const old = page.frameLocator(mount)
    await old.locator('#query').click()
    await expect(old.locator('#result')).toContainText('original-decision')
    await expect(old.locator('#result')).toContainText('original-candidate')
    expect(await choosePackage(page, samples.upgrade, { id, confirm: false })).toEqual({ version: undefined })
    expect(await list(page)).toEqual(initial)
    expectError(await choosePackage(page, samples.upgrade), 'id-conflict')
    expectError(await choosePackage(page, samples.differentId, { id }), 'upgrade-id-mismatch')
    expectError(await choosePackage(page, samples.equalVersion, { id }), 'upgrade-version-not-newer')
    expectError(await choosePackage(page, samples.olderVersion, { id }), 'upgrade-version-not-newer')
    expect(await list(page)).toEqual(initial)

    await page.evaluate(() => window.installProbe.holdCommit())
    const pendingUpgrade = choosePackage(page, samples.upgrade, { id })
    await expect.poll(() => page.evaluate(() => window.installProbe.isCommitWaiting())).toBe(true)
    expect(await list(page)).toEqual(initial)
    await expect(page.locator(mount)).toHaveCount(2)
    await expect(page.frameLocator(mount).nth(1).locator('#version')).toHaveText('1.1.0')
    await page.evaluate(() => window.installProbe.releaseCommit())
    expect(await pendingUpgrade).toEqual({ version: '1.1.0' })
    expect(await list(page)).toEqual(upgraded)
    await expect(page.locator(mount)).toHaveCount(1)
    await expect(old.locator('#version')).toHaveText('1.0.0')
    await old.locator('#respond').click()
    await expect(old.locator('#result')).toContainText('"status":"accepted"')
    expect(await page.evaluate(() => window.installProbe.metrics())).toMatchObject({ confirmationCount: 1 })

    await old.locator('#navigate').click()
    await expect(page.locator(mount)).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.installProbe.entries().then(rows => rows.length))).toBe(1)
    expect(await page.evaluate(packageId => window.installProbe.openCurrent(packageId), id)).toMatchObject({ version: '1.1.0' })
    const newFrontend = page.frameLocator(mount)
    await expect(newFrontend.locator('#version')).toHaveText('1.1.0')
    await newFrontend.locator('#query').click()
    await expect(newFrontend.locator('#result')).toContainText('"waiting":false')
  } finally {
    await context.close()
  }

  context = await chromium.launchPersistentContext(profile, launch)
  try {
    await context.setOffline(true)
    const page = await openInstalledPwa(context)
    expect(await list(page)).toEqual(upgraded)
    expect(await page.evaluate(packageId => window.installProbe.openCurrent(packageId), id)).toMatchObject({ version: '1.1.0' })
    await expect(page.frameLocator(mount).locator('#version')).toHaveText('1.1.0')
    await page.evaluate(packageId => window.installProbe.uninstall(packageId), id)
    await expect(page.locator(mount)).toHaveCount(0)
    expect(await list(page)).toEqual([])
    expect(await page.evaluate(() => window.installProbe.entries())).toEqual([])
  } finally {
    await context.close()
  }
})

test('makes failed initial candidates retryable and retains the installed version and live authorization after upgrade failures', async ({ page }) => {
  test.setTimeout(45_000)
  await page.goto(url)
  await ready(page)
  await page.context().setOffline(true)

  const failures = [
    { pack: { ...samples.initial, entryHtml: '<script src="/missing.js"></script>' }, code: 'resource-missing' },
    { pack: samples.silentInitial, code: 'handshake-timeout' },
    { pack: { ...samples.initial, entryHtml: packageClient('initial', 'wrong-handshake') }, code: 'handshake-invalid' },
    { pack: { ...samples.initial, entryHtml: packageClient('initial', 'reject-protocol') }, code: 'major-version-mismatch' },
    { pack: samples.initial, fault: 'entry', code: 'entry-load-failed' },
    { pack: samples.initial, fault: 'commit', code: 'space-insufficient' },
  ] as const

  for (const failure of failures) {
    await setFault(page, 'fault' in failure ? failure.fault : undefined)
    expectError(await choosePackage(page, failure.pack), failure.code)
    expect(await list(page)).toEqual([])
    await expect(page.locator(mount)).toHaveCount(0)
    expect(await page.evaluate(() => window.installProbe.entries())).toEqual([])
  }
  await setFault(page)
  expect(await choosePackage(page, samples.initial)).toEqual({ version: '1.0.0' })
  await page.evaluate(packageId => window.installProbe.openCurrent(packageId), id)
  const old = page.frameLocator(mount)
  await old.locator('#query').click()
  await expect(old.locator('#result')).toContainText('original-decision')

  for (const failure of failures) {
    await setFault(page, 'fault' in failure ? failure.fault : undefined)
    expectError(await choosePackage(page, { ...failure.pack, version: samples.upgrade.version }, { id }), failure.code)
    expect(await list(page)).toEqual(initial)
    await expect(page.locator(mount)).toHaveCount(1)
    await expect(old.locator('#version')).toHaveText('1.0.0')
    expect(await page.evaluate(() => window.installProbe.entries().then(rows => rows.length))).toBe(1)
  }
  await old.locator('#respond').click()
  await expect(old.locator('#result')).toContainText('"status":"accepted"')
  expect(await page.evaluate(() => window.installProbe.metrics())).toMatchObject({ confirmationCount: 1 })
})
