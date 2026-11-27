import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { build, preview } from 'vite'
import type { PreviewServer } from 'vite'

let temporary: string
let server: PreviewServer
let url: string

test.beforeAll(async () => {
  const root = fileURLToPath(new URL('../..', import.meta.url))
  const input = fileURLToPath(new URL('./recovery-fixture/index.html', import.meta.url))
  temporary = await mkdtemp(join(tmpdir(), 'critical-recovery-test-'))
  const config = {
    configFile: false as const,
    root,
    publicDir: false as const,
    logLevel: 'error' as const,
    build: { outDir: join(temporary, 'dist'), rolldownOptions: { input } },
    worker: { format: 'es' as const },
  }
  await build(config)
  server = await preview({ ...config, preview: {
    host: '127.0.0.1', port: 0, headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  } })
  const address = server.httpServer.address()
  if (!address || typeof address === 'string') throw new Error('Missing recovery test preview address')
  url = `http://127.0.0.1:${address.port}/tests/acceptance/recovery-fixture/index.html`
})

test.afterAll(async () => {
  try {
    if (server) await new Promise<void>((done, reject) => server.httpServer.close(error => error ? reject(error) : done()))
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true })
  }
})

async function ready(page: Page) {
  await page.goto(url)
  await page.waitForFunction(() => Boolean(window.recoveryProbe))
}

function rejection(reason: string) {
  return expect.objectContaining({
    type: 'response', interaction: 'M02', result: { status: 'rejected', reason },
  })
}

test('persistently restores the confirmed decision, receipts, cutoff and terminal outcome', async () => {
  test.setTimeout(60_000)
  const profile = join(temporary, 'recovery-profile')
  const options = { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined }
  let bases: { opening: string; rejection: string }
  let versionHash: string
  let original: unknown
  let context: BrowserContext = await chromium.launchPersistentContext(profile, options)
  try {
    const page = context.pages()[0]
    await ready(page)
    const result = await page.evaluate(() => window.recoveryProbe.writeAndPause())
    if (!result.latest) throw new Error('Expected a confirmed decision')
    bases = { opening: result.oldBasis, rejection: result.rejectionBasis }
    versionHash = result.latest.confirmed.versionHash
    original = result.latest
    expect(versionHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.initial).toEqual([expect.objectContaining({
      status: 'ready', sessionId: 'persistent-session', versionHash,
      metadata: { seatId: 'first', modelId: 'model-1' },
    })])
    expect(result.opening).toEqual([
      expect.objectContaining({ result: { status: 'accepted', receipt: { commandId: 'opening', result: { marker: 'waiting' } } } }),
      expect.objectContaining({ type: 'event', interaction: 'M04' }),
    ])
    expect(result.rejected).toEqual([rejection('illegal-choice')])
    expect(result.latest.confirmed).toMatchObject({
      revision: 1,
      state: {
        snapshotRef: 'recovery-release-v1', rulesVersion: 'recovery-test-v1', versionHash,
        progress: {
          kind: 'waiting', decision: {
            id: 'decision-1', owner: 'first', continuation: { selectedFrom: 0.625 },
            choices: { candidates: [{ id: 'second' }, { id: 'first' }] },
          },
        },
        random: { kind: 'recorded', inputs: [0.625, 0.875], consumed: 1 },
      },
    })
    const contender = await context.newPage()
    await ready(contender)
    expect(await contender.evaluate(() => window.recoveryProbe.contend())).toMatchObject({ code: 'occupied' })
  } finally {
    // Shut down Chromium without explicitly closing the worker or storage handle.
    await context.close()
  }

  context = await chromium.launchPersistentContext(profile, options)
  try {
    const page = context.pages()[0]
    await ready(page)
    const result = await page.evaluate(originalBases => window.recoveryProbe.restoreAndFinish(originalBases), bases)
    expect(result.latest).toEqual(original)
    expect(result.retry).toEqual([
      expect.objectContaining({ result: { status: 'accepted', receipt: { commandId: 'opening', result: { marker: 'waiting' } } } }),
    ])
    expect(result.accepted).toEqual([
      expect.objectContaining({ result: { status: 'accepted', receipt: { commandId: 'good-choice', result: { marker: 'active' } } } }),
      expect.objectContaining({ type: 'event' }),
    ])
    expect(result.oldRejection).toEqual([rejection('decision-expired')])
    expect(result.conflict).toEqual([rejection('command-id-conflict')])
    expect(result.ending).toEqual([
      expect.objectContaining({ result: { status: 'accepted', receipt: { commandId: 'terminal', result: { marker: 'ended' } } } }),
      expect.objectContaining({ type: 'event', event: expect.objectContaining({ type: 'terminal' }) }),
    ])
    expect(result.confirmations).toBe(2)
    expect(result.outcome).toEqual({ winner: 'second', reason: 'conceded' })
    expect(result.sessions).toEqual([expect.objectContaining({ status: 'ended', versionHash })])
    expect(result.history?.points.map(point => ({
      revision: point.confirmed.revision, versionHash: point.confirmed.versionHash, cutoff: point.summaryThrough,
    }))).toEqual([
      { revision: 0, versionHash, cutoff: 0 },
      { revision: 1, versionHash, cutoff: 1 },
      { revision: 2, versionHash, cutoff: 3 },
      { revision: 3, versionHash, cutoff: 4 },
    ])
    expect(result.history?.points[1]?.history).toEqual({ randomInputs: [0.625] })
    expect(result.history?.commands).toEqual([
      expect.objectContaining({ key: expect.objectContaining({ commandId: 'opening' }), versionHash, result: { marker: 'waiting' } }),
      expect.objectContaining({ key: expect.objectContaining({ commandId: 'bad-choice' }), versionHash, expectedRevision: 1 }),
      expect.objectContaining({ key: expect.objectContaining({ commandId: 'good-choice' }), versionHash, result: { marker: 'active' } }),
      expect.objectContaining({ key: expect.objectContaining({ commandId: 'terminal' }), versionHash, result: { marker: 'ended' } }),
    ])
    expect(result.history?.commands[1]).not.toHaveProperty('result')
  } finally {
    await context.close()
  }

  context = await chromium.launchPersistentContext(profile, options)
  try {
    const page = context.pages()[0]
    await ready(page)
    const result = await page.evaluate(() => window.recoveryProbe.readEnding())
    expect(result.outcome).toEqual({ winner: 'second', reason: 'conceded' })
    expect(result.latest.confirmed).toMatchObject({
      terminal: true, revision: 3, versionHash, state: { state: { value: 'first' } },
    })
    expect(result.terminal).toBeUndefined()
    expect(result.history?.commands.at(-1)).toMatchObject({
      key: { commandId: 'terminal' }, versionHash, result: { marker: 'ended' },
    })
  } finally {
    await context.close()
  }
})

test('does not confirm or publish an action when an actual OPFS write fails', async ({ page, context }) => {
  await ready(page)
  const result = await page.evaluate(() => window.recoveryProbe.setupAtomicFailure())
  expect(result.opfsEntries).toContain('.critical-provisional-matches')
  expect(result.sessions).toEqual([expect.objectContaining({ status: 'ready', versionHash: result.versionHash })])
  const cdp = await context.newCDPSession(page)
  const origin = new URL(url).origin
  const { usage } = await cdp.send('Storage.getUsageAndQuota', { origin })
  await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: usage })
  try {
    const failed = await page.evaluate(() => window.recoveryProbe.writeUnderQuota())
    expect(failed.rejected).toEqual([{ status: 'rejected', reason: 'storage-failed' }])
    expect(failed.failed).toEqual([rejection('storage-failed')])
    expect(failed.confirmations).toBe(0)
    expect(failed.revision).toBe(0)
  } finally {
    await cdp.send('Storage.overrideQuotaForOrigin', { origin })
    await cdp.detach()
  }

  const unchanged = await page.evaluate(() => window.recoveryProbe.inspectAfterFailure())
  expect(unchanged.latest?.confirmed).toMatchObject({ revision: 0, versionHash: result.versionHash })
  expect(unchanged.history?.points).toHaveLength(1)
  expect(unchanged.history?.commands).toEqual([])
  expect(unchanged.failed).toBeUndefined()
  expect(unchanged.rejected).toBeUndefined()
})

for (const [fault, description] of [
  ['delete-receipt', 'a checkpoint without its receipt'],
  ['invalidate-action', 'a checkpoint with an invalid stored action'],
] as const) {
  test(`reports an incomplete record for ${description}`, async ({ page }) => {
    await ready(page)
    const broken = await page.evaluate(operation => window.recoveryProbe.readCorruptRecord(operation), fault)
    expect(broken.latest).toMatchObject({ reason: 'incomplete-record' })
    expect(broken.history).toMatchObject({ reason: 'incomplete-record' })
  })
}
