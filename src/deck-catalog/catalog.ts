import { CatalogStorageError } from './catalog-errors'
import type { CatalogStorageErrorCode } from './catalog-errors'

export { CatalogStorageError } from './catalog-errors'
export type { CatalogStorageErrorCode } from './catalog-errors'

export type JsonValue = null | boolean | number | string | JsonObject | readonly JsonValue[]
export interface JsonObject { readonly [key: string]: JsonValue }

export type CardKind = 'unit' | 'spell' | 'trap' | 'ace'

export interface Card {
  readonly id: string
  readonly name: string
  readonly kind: CardKind
  readonly flagship: boolean
  readonly data: JsonObject
}

export interface DeckEntry {
  readonly cardId: string
  readonly quantity: number
}

export interface Preset {
  readonly id: string
  readonly name: string
  readonly entries: readonly DeckEntry[]
}

export interface ReleaseSummary {
  readonly id: string
  readonly rulesVersion: string
}

export interface Release extends ReleaseSummary {
  readonly cards: readonly Card[]
  readonly presets: readonly Preset[]
}

export interface CardCatalog {
  getRelease(id: string): Promise<Release | undefined>
  listReleases(): Promise<readonly ReleaseSummary[]>
}

export interface CatalogStorage {
  readonly catalog: CardCatalog
  /** Commit a candidate whose game rules were checked by the trusted publisher. */
  writeRelease(release: Release): Promise<void>
  close(): Promise<void>
}

export interface CatalogWorkerOperations {
  open: { request: { operation: 'open' }; result: undefined }
  close: { request: { operation: 'close' }; result: undefined }
  getRelease: { request: { operation: 'getRelease'; releaseId: string }; result: Release | undefined }
  listReleases: { request: { operation: 'listReleases' }; result: ReleaseSummary[] }
  writeRelease: { request: { operation: 'writeRelease'; release: Release }; result: undefined }
}

type Operation = keyof CatalogWorkerOperations
export type CatalogWorkerRequest = CatalogWorkerOperations[Operation]['request'] & { id: number }
export type CatalogWorkerResponse = { id: number } & (
  | { ok: true; value: CatalogWorkerOperations[Operation]['result'] }
  | { ok: false; code: CatalogStorageErrorCode; message: string }
)

type PendingRequest = {
  resolve: (value: CatalogWorkerOperations[Operation]['result']) => void
  reject: (error: CatalogStorageError) => void
}

function freeze<Value>(value: Value): Value {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

/** Open the trusted host's exclusive catalog worker. Expose only `catalog` to readers. */
export async function openCatalogStorage(): Promise<CatalogStorage> {
  if (typeof Worker !== 'function') {
    throw new CatalogStorageError('unavailable', 'The catalog requires a dedicated Worker')
  }
  let worker: Worker
  try {
    worker = new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module' })
  } catch (error) {
    throw new CatalogStorageError('unavailable', error instanceof Error ? error.message : String(error))
  }
  const pending = new Map<number, PendingRequest>()
  let nextId = 0
  let stopped = false
  let closing: Promise<void> | undefined

  function stop(error: CatalogStorageError) {
    stopped = true
    worker.terminate()
    for (const { reject } of pending.values()) reject(error)
    pending.clear()
  }

  worker.onmessage = ({ data }: MessageEvent<CatalogWorkerResponse>) => {
    const request = pending.get(data.id)
    if (!request) return
    pending.delete(data.id)
    if (data.ok) request.resolve(data.value)
    else request.reject(new CatalogStorageError(data.code, data.message))
  }
  worker.onerror = (event) => stop(new CatalogStorageError('storage-failed', event.message || 'Catalog worker failed'))
  worker.onmessageerror = () => stop(new CatalogStorageError('storage-failed', 'Catalog response could not be read'))

  async function request<Name extends Operation>(
    message: CatalogWorkerOperations[Name]['request'],
  ): Promise<CatalogWorkerOperations[Name]['result']> {
    if (stopped || closing) throw new CatalogStorageError('closed', 'Catalog storage is closed')
    const id = ++nextId
    const reply = new Promise<CatalogWorkerOperations[Operation]['result']>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      try {
        worker.postMessage({ ...message, id })
      } catch (error) {
        pending.delete(id)
        const code = message.operation === 'writeRelease' ? 'invalid-release' : 'storage-failed'
        reject(new CatalogStorageError(code, error instanceof Error ? error.message : String(error)))
      }
    })
    // The reply ID ties the value to the typed operation selected by this caller.
    return await reply as CatalogWorkerOperations[Name]['result']
  }

  try {
    await request<'open'>({ operation: 'open' })
  } catch (error) {
    stop(new CatalogStorageError('closed', 'Catalog storage did not open'))
    throw error
  }
  return {
    catalog: {
      getRelease: async (releaseId) => freeze(await request<'getRelease'>({ operation: 'getRelease', releaseId })),
      listReleases: async () => freeze(await request<'listReleases'>({ operation: 'listReleases' })),
    },
    writeRelease: async (release) => { await request<'writeRelease'>({ operation: 'writeRelease', release }) },
    close() {
      if (stopped) return Promise.resolve()
      closing ??= request<'close'>({ operation: 'close' }).finally(() => {
        stop(new CatalogStorageError('closed', 'Catalog storage is closed'))
      })
      return closing
    },
  }
}
