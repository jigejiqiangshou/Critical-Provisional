import { FrontendHost } from '../../../src/clients/frontend-host'
import { FrontendInstaller } from '../../../src/clients/launcher/install'
import { FrontendPackageStore } from '../../../src/clients/launcher/package-store'
import { registerHostWorker } from '../../../src/clients/offline-ready'
import { openFrontendDatabase, frontendEntryStore, frontendInstallationStore } from '../../../src/clients/frontend-entry'
import { PlayerInterface } from '../../../src/match/player-interface'
import type { CommandReceipt, CommandReceiptKey, CommandRequestSummary, ViewScope } from '../../../src/match/player-protocol'

type Fault = 'none' | 'entry' | 'commit'

const sessionId = 'installer-test-match'
const first: ViewScope = { type: 'seat', seatId: 'first' }
const scope = new URL('./', location.href)
const marker = document.createElement('div')
marker.id = 'installer-test-marker'
marker.hidden = true
marker.textContent = 'trusted-host-dom'
const fileInput = document.createElement('input')
fileInput.id = 'package-file'
fileInput.type = 'file'
fileInput.accept = '.critical-ui'
const mount = document.createElement('div')
mount.id = 'frontends'
document.body.append(marker, fileInput, mount)
localStorage.setItem(marker.id, 'trusted-host-storage')

const host = new FrontendHost({ mount, scope, timeoutMs: 1500 })
let holdCommit: Promise<void> | undefined
let releaseCommit: (() => void) | undefined
let commitWaiting = false

class ObservedStore extends FrontendPackageStore {
  override async commit(...args: Parameters<FrontendPackageStore['commit']>) {
    if (holdCommit) {
      commitWaiting = true
      await holdCommit
      commitWaiting = false
    }
    return super.commit(...args)
  }
}

const store = new ObservedStore(scope)
const installer = new FrontendInstaller(store, async candidate => {
  if (currentFault === 'entry') {
    const database = await openFrontendDatabase(scope)
    try {
      const transaction = database.transaction(frontendEntryStore, 'readwrite')
      transaction.objectStore(frontendEntryStore).delete(candidate.entryKey)
      await new Promise<void>((done, reject) => {
        transaction.oncomplete = () => done()
        transaction.onabort = () => reject(transaction.error)
      })
    } finally {
      database.close()
    }
  }
  return host.checkCandidate(candidate)
})
const summaries = new Map<string, CommandReceipt | CommandRequestSummary>()
let queryProjectionCount = 0
let confirmationCount = 0
let confirmationPrompts = 0
let currentFault: Fault = 'none'
let open: Awaited<ReturnType<typeof host.openInstalled>> | undefined

const player = new PlayerInterface({
  sessionId,
  confirmed: { revision: 0, versionHash: 'a'.repeat(64), state: { waiting: true } },
  core: {
    project(current, viewScope) {
      queryProjectionCount++
      return {
        waiting: current.state.waiting,
        ...(current.state.waiting && viewScope.type === 'seat' && viewScope.seatId === 'first'
          ? { decisionId: 'original-decision', candidates: ['original-candidate'] }
          : {}),
      }
    },
    adjudicate({ seatId, current, action }) {
      if (
        seatId !== 'first' || !current.state.waiting || action.type !== 'respond' ||
        action.decisionId !== 'original-decision' || action.choice.type !== 'select' ||
        action.choice.targetIds.join(',') !== 'original-candidate'
      ) return { status: 'rejected', reason: 'illegal-choice' }
      return {
        status: 'accepted',
        next: { ...current, state: { waiting: false }, revision: current.revision + 1 },
        result: { decisionId: action.decisionId, targetId: 'original-candidate' },
        events: [{ visibility: { type: 'public' }, event: { type: 'action', payload: { waiting: false } } }],
      }
    },
  },
  store: {
    lookup: (key: CommandReceiptKey) => summaries.get(key.commandId),
    recordRejection: summary => { summaries.set(summary.key.commandId, summary) },
    confirm: ({ receipt }) => {
      summaries.set(receipt.key.commandId, receipt)
      confirmationCount++
    },
  },
})

function result(error: unknown) {
  return {
    code: typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined,
    message: error instanceof Error ? error.message : String(error),
  }
}

// Fail the real publication transaction after staging. Other IDB requests remain untouched.
const originalPut = IDBObjectStore.prototype.put
IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
  if (currentFault === 'commit' && this.name === frontendInstallationStore) {
    throw new DOMException('Injected active installation quota failure', 'QuotaExceededError')
  }
  return originalPut.apply(this, args)
}

async function selected(id?: string, confirm = true) {
  const file = fileInput.files?.[0]
  if (!file) throw new Error('Select an offline package first')
  const confirmSource = () => { confirmationPrompts++; return confirm }
  try {
    const installation = await (id ? installer.upgrade(id, file, confirmSource) : installer.install(file, confirmSource))
    return { version: installation?.manifest.version }
  } catch (error) {
    return { error: result(error) }
  }
}

async function openCurrent(id: string, viewScope = first) {
  const pin = await store.pinActive(id, () => open?.close())
  if (!pin) throw new Error('No active installation')
  try {
    open = await host.openInstalled(pin.installation, { player, scope: viewScope }, () => { void pin.release() })
    return { version: pin.installation.manifest.version, entryUrl: open.iframe.src }
  } catch (error) {
    await pin.release()
    throw error
  }
}

async function requestFrontendEntries() {
  const database = await openFrontendDatabase(scope)
  try {
    const transaction = database.transaction(frontendEntryStore)
    const request = transaction.objectStore(frontendEntryStore).getAll()
    return await new Promise<unknown[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    database.close()
  }
}

const probe = {
  selected,
  list: async () => (await store.list()).map(row => [row.manifest.id, row.manifest.version]),
  openCurrent,
  close: () => { open?.close() },
  uninstall: (id: string) => installer.uninstall(id),
  setFault: (fault: Fault) => { currentFault = fault },
  metrics: () => ({ queryProjectionCount, confirmationCount, confirmationPrompts }),
  entries: requestFrontendEntries,
  holdCommit: () => { holdCommit = new Promise<void>(done => { releaseCommit = done }) },
  isCommitWaiting: () => commitWaiting,
  releaseCommit: () => {
    releaseCommit?.()
    releaseCommit = undefined
    holdCommit = undefined
  },
}

declare global {
  interface Window {
    installProbe: typeof probe
  }
}

void (async () => {
  await registerHostWorker(scope)
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>(done => navigator.serviceWorker.addEventListener('controllerchange', () => done(), { once: true }))
  }
  window.installProbe = probe
  window.addEventListener('pagehide', () => store.close(), { once: true })
})()
