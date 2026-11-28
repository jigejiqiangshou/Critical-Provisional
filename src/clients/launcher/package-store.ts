import {
  frontendEntryStore,
  frontendInstallationStore,
  openFrontendDatabase,
} from '../frontend-entry'
import type { VerifiedFrontendEntry } from '../frontend-entry'

export interface FrontendManifest {
  readonly formatVersion: 1
  readonly id: string
  readonly version: string
  readonly name: string
  readonly protocolMajor: number
  readonly protocolMinMinor: number
}

export interface FrontendCandidate {
  readonly entryKey: string
  readonly instanceToken: string
  readonly manifest: FrontendManifest
}

export interface Installation {
  readonly key: string
  readonly state: 'active'
  readonly manifest: FrontendManifest
  readonly entryKey: string
  readonly source: 'third-party' | 'official'
}

export interface PinnedInstallation {
  readonly installation: Installation
  release(): void
}

interface StoredEntry extends VerifiedFrontendEntry {
  readonly packageId: string
  readonly stageInstance?: string
}

function readRequest<Value>(request: IDBRequest<Value>): Promise<Value> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new DOMException('Frontend transaction aborted', 'AbortError'))
  })
}

export class FrontendPackageStore {
  private readonly lockPrefix: string
  private readonly channel: BroadcastChannel
  private readonly instances = new Map<string, Set<() => void>>()

  constructor(private readonly scope: URL) {
    this.lockPrefix = 'critical-frontend:' + scope.pathname + ':'
    this.channel = new BroadcastChannel(this.lockPrefix + 'instances')
    this.channel.onmessage = (event: MessageEvent<unknown>) => {
      if (typeof event.data === 'string') this.closeInstances(event.data)
    }
  }

  async list(): Promise<Installation[]> {
    return this.inTransaction([frontendInstallationStore], 'readonly', async transaction => {
      return readRequest(transaction.objectStore(frontendInstallationStore).getAll())
    })
  }

  async get(id: string): Promise<Installation | undefined> {
    return this.inTransaction([frontendInstallationStore], 'readonly', async transaction => {
      return readRequest(transaction.objectStore(frontendInstallationStore).get(id))
    })
  }

  withPackage<Value>(id: string, operation: () => Promise<Value>): Promise<Value> {
    return navigator.locks.request(this.lockPrefix + 'package:' + id, operation)
  }

  async stage(candidate: FrontendCandidate, html: string): Promise<void> {
    const entry: StoredEntry = {
      key: candidate.entryKey,
      html,
      packageId: candidate.manifest.id,
      stageInstance: candidate.instanceToken,
    }
    await this.inTransaction([frontendEntryStore], 'readwrite', async transaction => {
      transaction.objectStore(frontendEntryStore).add(entry)
    })
  }

  async commit(
    candidate: FrontendCandidate,
    prior: Installation | undefined,
    source: Installation['source'],
  ): Promise<Installation> {
    const installation: Installation = {
      key: candidate.manifest.id,
      state: 'active',
      manifest: candidate.manifest,
      entryKey: candidate.entryKey,
      source,
    }
    return this.inTransaction([frontendEntryStore, frontendInstallationStore], 'readwrite', async transaction => {
      const entries = transaction.objectStore(frontendEntryStore)
      const installs = transaction.objectStore(frontendInstallationStore)
      const [staged, current]: [StoredEntry | undefined, Installation | undefined] = await Promise.all([
        readRequest(entries.get(candidate.entryKey)),
        readRequest(installs.get(installation.key)),
      ])
      if (!staged || staged.packageId !== installation.key || staged.stageInstance !== candidate.instanceToken) {
        throw new Error('Frontend candidate is missing')
      }
      if (current?.entryKey !== prior?.entryKey) throw new Error('Frontend installation changed')
      entries.put({ key: staged.key, html: staged.html, packageId: staged.packageId } satisfies StoredEntry)
      installs.put(installation)
      return installation
    })
  }

  async discard(candidate: FrontendCandidate): Promise<void> {
    await this.inTransaction([frontendEntryStore], 'readwrite', async transaction => {
      const entries = transaction.objectStore(frontendEntryStore)
      const entry: StoredEntry | undefined = await readRequest(entries.get(candidate.entryKey))
      if (entry?.stageInstance === candidate.instanceToken) entries.delete(candidate.entryKey)
    })
  }

  async pinActive(id: string, closeInstance: () => void): Promise<PinnedInstallation | undefined> {
    return this.withPackage(id, async () => {
      const installation = await this.get(id)
      if (!installation) return undefined

      // A shared Web Lock follows the browsing context and is released even after a crash.
      let unlock!: () => void
      const held = new Promise<void>(resolve => { unlock = resolve })
      let acquired!: () => void
      const ready = new Promise<void>(resolve => { acquired = resolve })
      const entryKey = installation.entryKey
      const lock = navigator.locks.request(this.entryLock(entryKey), { mode: 'shared' }, () => {
        acquired()
        return held
      })
      await Promise.race([ready, lock])
      const callbacks = this.instances.get(entryKey) ?? new Set<() => void>()
      const release = () => {
        if (!callbacks.delete(close)) return
        if (!callbacks.size) this.instances.delete(entryKey)
        unlock()
        void lock.then(() => this.withPackage(id, () => this.collect(id))).catch(() => {})
      }
      const close = () => {
        try {
          closeInstance()
        } finally {
          release()
        }
      }
      callbacks.add(close)
      this.instances.set(entryKey, callbacks)
      return { installation, release }
    })
  }

  /** Call under the package lock, including after an import interrupted by a prior browser stop. */
  async collect(id: string): Promise<void> {
    const current = await this.get(id)
    const keys = await this.entryKeys(id)
    for (const key of keys) {
      if (key === current?.entryKey) continue
      await navigator.locks.request(this.entryLock(key), { ifAvailable: true }, async lock => {
        if (lock) await this.deleteEntry(key)
      })
    }
  }

  /** Call under the package lock so another tab cannot open a version during uninstall. */
  async remove(id: string): Promise<boolean> {
    if (!await this.get(id)) return false
    const keys = await this.entryKeys(id)
    for (const key of keys) {
      this.closeInstances(key)
      this.channel.postMessage(key)
    }
    for (const key of keys) {
      await navigator.locks.request(this.entryLock(key), { signal: AbortSignal.timeout(10_000) }, () => {})
    }
    await this.inTransaction([frontendEntryStore, frontendInstallationStore], 'readwrite', async transaction => {
      transaction.objectStore(frontendInstallationStore).delete(id)
      for (const key of keys) transaction.objectStore(frontendEntryStore).delete(key)
    })
    return true
  }

  close(): void {
    for (const key of this.instances.keys()) this.closeInstances(key)
    this.channel.close()
  }

  private closeInstances(entryKey: string): void {
    for (const close of this.instances.get(entryKey) ?? []) {
      // A host callback failure must not strand the lease or another instance.
      try { close() } catch { /* The callback's finally releases this lease. */ }
    }
  }

  private entryLock(entryKey: string): string {
    return this.lockPrefix + 'entry:' + entryKey
  }

  private async entryKeys(id: string): Promise<string[]> {
    return this.inTransaction([frontendEntryStore], 'readonly', transaction => new Promise((resolve, reject) => {
      // The T005 database has no package index. A cursor avoids cloning all package HTML at once.
      const keys: string[] = []
      const request = transaction.objectStore(frontendEntryStore).openCursor()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve(keys)
          return
        }
        const entry: StoredEntry = cursor.value
        if (entry.packageId === id) keys.push(entry.key)
        cursor.continue()
      }
    }))
  }

  private async deleteEntry(key: string): Promise<void> {
    await this.inTransaction([frontendEntryStore], 'readwrite', async transaction => {
      transaction.objectStore(frontendEntryStore).delete(key)
    })
  }

  private async inTransaction<Value>(
    stores: string[],
    mode: IDBTransactionMode,
    operation: (transaction: IDBTransaction) => Promise<Value>,
  ): Promise<Value> {
    const database = await openFrontendDatabase(this.scope)
    try {
      const transaction = database.transaction(stores, mode)
      const done = transactionDone(transaction)
      const result = operation(transaction).catch(error => {
        try { transaction.abort() } catch { /* The transaction already aborted. */ }
        throw error
      })
      const [value] = await Promise.all([result, done])
      return value
    } finally {
      database.close()
    }
  }
}
