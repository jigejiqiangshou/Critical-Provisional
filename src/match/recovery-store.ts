import { MatchRecoveryError } from './core'
import type { MatchRecoveryReason } from './core'
import type { CommandConfirmation, ConfirmedMatch, PlayerCommandStore } from './player-interface'
import type {
  CommandReceipt, CommandReceiptKey, CommandRequestSummary, JsonValue, PlayerAction, SessionId,
} from './player-protocol'
import type { MatchOutcome } from './rules'

import { RecoveryStorageError } from './recovery-errors'
import type { RecoveryStorageErrorCode } from './recovery-errors'

export { RecoveryStorageError } from './recovery-errors'
export type { RecoveryStorageErrorCode } from './recovery-errors'

export interface InitialConfirmation<State, History, Metadata> {
  readonly sessionId: SessionId
  readonly confirmed: ConfirmedMatch<State>
  /** The trusted host's original seat bindings and preparation configuration. */
  readonly metadata: Metadata
  readonly history?: History
}

export type RecoverySession<Metadata> = { readonly sessionId: SessionId; readonly versionHash: string } & (
  | { readonly status: 'ready'; readonly metadata: Metadata }
  | { readonly status: 'ended' }
)

export interface LatestConfirmation<State, Metadata> {
  readonly sessionId: SessionId
  readonly confirmed: ConfirmedMatch<State>
  readonly metadata: Metadata
  readonly summaryThrough: number
}

export interface RecoveryPoint<State, History> {
  readonly confirmed: ConfirmedMatch<State>
  // Registration ordinals through this value were already present at this confirmation.
  readonly summaryThrough: number
  readonly action?: PlayerAction
  readonly history?: History
}

export type RecoveryCommand = CommandRequestSummary & { readonly ordinal: number } & (
  | { readonly confirmationRevision?: never; readonly result?: never }
  | { readonly confirmationRevision: number; readonly result: JsonValue }
)

export interface RecoveryHistory<State, History> {
  readonly points: readonly RecoveryPoint<State, History>[]
  // A promoted rejection remains a summary at points before confirmationRevision.
  readonly commands: readonly RecoveryCommand[]
}

/** Only trusted match and launcher code may hold this capability. */
export interface RecoveryStore<State, History = unknown, Metadata = JsonValue>
  extends PlayerCommandStore<State, History> {
  initialize(input: InitialConfirmation<State, History, Metadata>): Promise<void>
  listSessions(): Promise<readonly RecoverySession<Metadata>[]>
  loadLatest(sessionId: SessionId): Promise<LatestConfirmation<State, Metadata> | undefined>
  readOutcome(sessionId: SessionId): Promise<MatchOutcome | undefined>
  readHistory(sessionId: SessionId): Promise<RecoveryHistory<State, History> | undefined>
  close(): Promise<void>
}

/** Internal protocol between the match host and its dedicated storage worker. */
export interface RecoveryWorkerOperations {
  open: { request: { operation: 'open' }; result: undefined }
  close: { request: { operation: 'close' }; result: undefined }
  initialize: {
    request: { operation: 'initialize'; input: InitialConfirmation<unknown, unknown, unknown> }; result: undefined
  }
  listSessions: { request: { operation: 'listSessions' }; result: readonly RecoverySession<unknown>[] }
  loadLatest: {
    request: { operation: 'loadLatest'; sessionId: SessionId }; result: LatestConfirmation<unknown, unknown> | undefined
  }
  readOutcome: { request: { operation: 'readOutcome'; sessionId: SessionId }; result: MatchOutcome | undefined }
  readHistory: {
    request: { operation: 'readHistory'; sessionId: SessionId }; result: RecoveryHistory<unknown, unknown> | undefined
  }
  lookup: {
    request: { operation: 'lookup'; key: CommandReceiptKey }; result: CommandRequestSummary | CommandReceipt | undefined
  }
  recordRejection: {
    request: { operation: 'recordRejection'; summary: CommandRequestSummary }; result: undefined
  }
  confirm: {
    request: { operation: 'confirm'; confirmation: CommandConfirmation<unknown> }; result: undefined
  }
}

type Operation = keyof RecoveryWorkerOperations
type Result = RecoveryWorkerOperations[Operation]['result']
export type RecoveryWorkerRequest = RecoveryWorkerOperations[Operation]['request'] & { id: number }
export type RecoveryWorkerResponse = { id: number } & (
  | { ok: true; value: Result }
  | { ok: false; code: RecoveryStorageErrorCode; message: string }
  | { ok: false; reason: MatchRecoveryReason }
)

export async function openRecoveryStore<State, History = unknown, Metadata = JsonValue>():
Promise<RecoveryStore<State, History, Metadata>> {
  if (typeof Worker !== 'function') {
    throw new RecoveryStorageError('unavailable', 'Match recovery requires a dedicated Worker')
  }

  let worker: Worker
  try {
    worker = new Worker(new URL('./recovery.worker.ts', import.meta.url), { type: 'module' })
  } catch (error) {
    throw new RecoveryStorageError('unavailable', error instanceof Error ? error.message : String(error))
  }

  const pending = new Map<number, { resolve(value: Result): void; reject(error: unknown): void }>()
  let nextId = 0
  let stopped = false
  let closing: Promise<void> | undefined

  function stop(error: RecoveryStorageError) {
    stopped = true
    worker.terminate()
    for (const { reject } of pending.values()) reject(error)
    pending.clear()
  }

  worker.onmessage = ({ data }: MessageEvent<RecoveryWorkerResponse>) => {
    const request = pending.get(data.id)
    if (!request) return
    pending.delete(data.id)
    if (data.ok) request.resolve(data.value)
    else if ('reason' in data) request.reject(new MatchRecoveryError(data.reason))
    else request.reject(new RecoveryStorageError(data.code, data.message))
  }
  worker.onerror = event => stop(new RecoveryStorageError('storage-failed', event.message || 'Match recovery worker failed'))
  worker.onmessageerror = () => stop(new RecoveryStorageError('storage-failed', 'Match recovery response could not be read'))

  async function request<Name extends Operation>(
    message: RecoveryWorkerOperations[Name]['request'],
  ): Promise<RecoveryWorkerOperations[Name]['result']> {
    if (stopped || closing) throw new RecoveryStorageError('closed', 'Match recovery storage is closed')
    const id = ++nextId
    const reply = new Promise<Result>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      try {
        worker.postMessage({ ...message, id })
      } catch (error) {
        pending.delete(id)
        reject(new RecoveryStorageError('storage-failed', error instanceof Error ? error.message : String(error)))
      }
    })
    // The response ID pairs the result with the operation sent to the worker.
    return await reply as RecoveryWorkerOperations[Name]['result']
  }

  try {
    await request<'open'>({ operation: 'open' })
  } catch (error) {
    stop(new RecoveryStorageError('closed', 'Match recovery storage did not open'))
    throw error
  }

  return {
    initialize: input => request<'initialize'>({ operation: 'initialize', input }),
    listSessions: () => request<'listSessions'>({ operation: 'listSessions' }) as Promise<readonly RecoverySession<Metadata>[]>,
    loadLatest: sessionId => request<'loadLatest'>({ operation: 'loadLatest', sessionId }) as
      Promise<LatestConfirmation<State, Metadata> | undefined>,
    readOutcome: sessionId => request<'readOutcome'>({ operation: 'readOutcome', sessionId }),
    readHistory: sessionId => request<'readHistory'>({ operation: 'readHistory', sessionId }) as
      Promise<RecoveryHistory<State, History> | undefined>,
    lookup: key => request<'lookup'>({ operation: 'lookup', key }),
    recordRejection: summary => request<'recordRejection'>({ operation: 'recordRejection', summary }),
    confirm: confirmation => request<'confirm'>({ operation: 'confirm', confirmation }),
    close() {
      if (stopped) return Promise.resolve()
      closing ??= request<'close'>({ operation: 'close' }).finally(() => {
        stop(new RecoveryStorageError('closed', 'Match recovery storage is closed'))
      })
      return closing
    },
  }
}
