/// <reference types="vite/client" />
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import type { OpfsSAHPoolDatabase, SqlValue } from '@sqlite.org/sqlite-wasm'
import { MatchRecoveryError, stableJson } from './core'
import type { CommandConfirmation, ConfirmedMatch } from './player-interface'
import type { CommandReceiptKey, CommandRequestSummary, JsonValue, PlayerAction, SessionId } from './player-protocol'
import { RecoveryStorageError } from './recovery-errors'
import type {
  InitialConfirmation, LatestConfirmation, RecoveryCommand, RecoveryHistory, RecoveryPoint,
  RecoverySession, RecoveryWorkerRequest, RecoveryWorkerResponse,
} from './recovery-store'
import type { MatchOutcome } from './rules'
import schema from './recovery.sql?raw'

const port = self as unknown as Pick<MessagePort, 'onmessage' | 'postMessage'>
const schemaVersion = 1
let database: OpfsSAHPoolDatabase | undefined
let lease: Promise<void> | undefined
let releaseLock: (() => void) | undefined

function initializeSchema(db: OpfsSAHPoolDatabase) {
  db.exec('PRAGMA foreign_keys = ON')
  const version = db.selectValue('PRAGMA user_version')
  if (version === schemaVersion) return
  if (version !== 0) throw new RecoveryStorageError('unavailable', `Unsupported recovery schema version ${version}`)
  db.transaction('IMMEDIATE', tx => {
    tx.exec(schema)
    tx.exec(`PRAGMA user_version = ${schemaVersion}`)
  })
}

async function holdDatabase(onReady: () => void) {
  if (!navigator.locks || !navigator.storage?.getDirectory) {
    throw new RecoveryStorageError('unavailable', 'Web Locks and OPFS are required for match recovery')
  }
  await navigator.locks.request('critical-provisional:match-writer', { mode: 'exclusive', ifAvailable: true }, async lock => {
    if (!lock) throw new RecoveryStorageError('occupied', 'Another app instance holds the match writer lock')
    const sqlite = await sqlite3InitModule()
    const pool = await sqlite.installOpfsSAHPoolVfs({
      name: 'critical-match-sahpool',
      directory: '.critical-provisional-matches',
      preserveOnInitFailure: true,
    })
    try {
      database = new pool.OpfsSAHPoolDb('/matches.sqlite3')
      initializeSchema(database)
      const closed = new Promise<void>(resolve => { releaseLock = resolve })
      onReady()
      await closed
    } finally {
      try {
        database?.close()
      } finally {
        database = undefined
        releaseLock = undefined
        pool.pauseVfs()
      }
    }
  })
}

type Row = Record<string, SqlValue>

function incomplete(): never {
  throw new MatchRecoveryError('incomplete-record')
}

function checkHash(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new MatchRecoveryError('version-hash-mismatch')
}

function textField(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function revision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function decode(value: SqlValue): unknown {
  if (typeof value !== 'string') return incomplete()
  try {
    return JSON.parse(value) as unknown
  } catch {
    return incomplete()
  }
}

function validOutcome(value: unknown): value is MatchOutcome {
  return typeof value === 'object' && value !== null && 'winner' in value && 'reason' in value &&
    (value.winner === null || textField(value.winner)) && textField(value.reason)
}

function validSnapshot(value: unknown): value is ConfirmedMatch<unknown> {
  return typeof value === 'object' && value !== null && 'state' in value &&
    'revision' in value && revision(value.revision) &&
    'versionHash' in value && /^[a-f0-9]{64}$/.test(typeof value.versionHash === 'string' ? value.versionHash : '') &&
    ('terminal' in value && value.terminal === true
      ? 'outcome' in value && validOutcome(value.outcome)
      : (!('terminal' in value) || value.terminal === false) && !('outcome' in value))
}

function matchRow(db: OpfsSAHPoolDatabase, sessionId: SessionId): Row | undefined {
  return db.selectObject('SELECT * FROM matches WHERE session_id = ?', [sessionId])
}

function activeMatch(db: OpfsSAHPoolDatabase, sessionId: SessionId): Row {
  const match = matchRow(db, sessionId)
  if (!match || match.outcome !== null) throw new RecoveryStorageError('storage-failed', 'Match is not active')
  return match
}

function pointRow(db: OpfsSAHPoolDatabase, sessionId: SessionId, atRevision: SqlValue): Row {
  return db.selectObject('SELECT * FROM confirmations WHERE session_id = ? AND revision = ?', [sessionId, atRevision])
    ?? incomplete()
}

function readPoint(row: Row, versionHash: SqlValue): RecoveryPoint<unknown, unknown> {
  checkHash(row.version_hash, versionHash)
  const confirmed = decode(row.snapshot)
  if (!validSnapshot(confirmed) || confirmed.revision !== row.revision || !revision(row.summary_through)) return incomplete()
  checkHash(confirmed.versionHash, versionHash)
  return {
    confirmed,
    summaryThrough: row.summary_through,
    ...(row.action === null ? {} : { action: decode(row.action) as PlayerAction }),
    ...(row.history === null ? {} : { history: decode(row.history) }),
  }
}

function checkOutcome(match: Row, confirmed: ConfirmedMatch<unknown>): void {
  if (match.outcome === null ? confirmed.terminal : !confirmed.terminal ||
    stableJson(decode(match.outcome)) !== stableJson(confirmed.outcome)) incomplete()
}

function listSessions(db: OpfsSAHPoolDatabase): RecoverySession<unknown>[] {
  return db.selectObjects('SELECT * FROM matches ORDER BY session_id').map(match => {
    if (!textField(match.session_id) || !textField(match.version_hash)) return incomplete()
    const session = { sessionId: match.session_id, versionHash: match.version_hash }
    return match.outcome === null
      ? { ...session, status: 'ready', metadata: decode(match.metadata) }
      : { ...session, status: 'ended' }
  })
}

function readOutcome(db: OpfsSAHPoolDatabase, sessionId: SessionId): MatchOutcome | undefined {
  const match = matchRow(db, sessionId)
  if (!match || match.outcome === null) return undefined
  const outcome = decode(match.outcome)
  return validOutcome(outcome) ? outcome : incomplete()
}

function loadLatest(db: OpfsSAHPoolDatabase, sessionId: SessionId): LatestConfirmation<unknown, unknown> | undefined {
  const match = matchRow(db, sessionId)
  if (!match) return undefined
  const { confirmed, summaryThrough } = readPoint(pointRow(db, sessionId, match.current_revision), match.version_hash)
  checkOutcome(match, confirmed)
  return { sessionId, confirmed, metadata: decode(match.metadata), summaryThrough }
}

function commandRow(db: OpfsSAHPoolDatabase, key: CommandReceiptKey): Row | undefined {
  return db.selectObject(
    'SELECT * FROM commands WHERE session_id = ? AND seat_id = ? AND command_id = ?',
    [key.sessionId, key.seatId, key.commandId],
  )
}

function readCommand(row: Row, versionHash: SqlValue): RecoveryCommand {
  checkHash(row.version_hash, versionHash)
  if (!textField(row.session_id) || !textField(row.seat_id) || !textField(row.command_id) ||
    !textField(row.version_hash) || !textField(row.request_digest) || !revision(row.expected_revision) ||
    !revision(row.ordinal) || row.ordinal < 1) return incomplete()
  const summary = {
    key: { sessionId: row.session_id, seatId: row.seat_id, commandId: row.command_id },
    versionHash: row.version_hash, requestDigest: row.request_digest,
    expectedRevision: row.expected_revision, ordinal: row.ordinal,
  }
  if (row.confirmation_revision === null) return summary
  if (!revision(row.confirmation_revision)) return incomplete()
  return { ...summary, confirmationRevision: row.confirmation_revision, result: decode(row.result) as JsonValue }
}

function lookup(db: OpfsSAHPoolDatabase, key: CommandReceiptKey): CommandRequestSummary | undefined {
  const match = matchRow(db, key.sessionId)
  if (!match || match.outcome !== null) return undefined
  const row = commandRow(db, key)
  if (!row) return undefined
  const { ordinal: _ordinal, confirmationRevision, ...command } = readCommand(row, match.version_hash)
  if (confirmationRevision !== undefined && confirmationRevision > Number(match.current_revision)) return incomplete()
  return command
}

function readHistory(db: OpfsSAHPoolDatabase, sessionId: SessionId): RecoveryHistory<unknown, unknown> | undefined {
  const match = matchRow(db, sessionId)
  if (!match) return undefined
  const points = db.selectObjects('SELECT * FROM confirmations WHERE session_id = ? ORDER BY revision', [sessionId])
    .map(row => readPoint(row, match.version_hash))
  const commands = db.selectObjects('SELECT * FROM commands WHERE session_id = ? ORDER BY ordinal', [sessionId])
    .map(row => readCommand(row, match.version_hash))
  const latest = points.at(-1)
  if (!latest || latest.confirmed.revision !== match.current_revision) return incomplete()
  checkOutcome(match, latest.confirmed)
  const receipts = new Map<number, RecoveryCommand>()
  for (const [index, command] of commands.entries()) {
    if (command.ordinal !== index + 1) return incomplete()
    if (command.confirmationRevision !== undefined) {
      if (command.confirmationRevision > points.length - 1) return incomplete()
      receipts.set(command.confirmationRevision, command)
    }
  }
  let through = 0
  for (const [index, point] of points.entries()) {
    if (point.confirmed.revision !== index || point.summaryThrough < through || point.summaryThrough > commands.length ||
      (index < points.length - 1 && point.confirmed.terminal)) return incomplete()
    through = point.summaryThrough
    if (index > 0) {
      const receipt = receipts.get(index)
      if (!receipt || receipt.ordinal > through || receipt.expectedRevision !== index - 1) return incomplete()
    }
  }
  return { points, commands }
}

function insertPoint(
  db: OpfsSAHPoolDatabase, sessionId: SessionId, confirmed: ConfirmedMatch<unknown>, through: number,
  action: PlayerAction | undefined, history: unknown,
): void {
  db.exec({
    sql: `INSERT INTO confirmations (session_id, version_hash, revision, snapshot, summary_through, action, history)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    bind: [sessionId, confirmed.versionHash, confirmed.revision, stableJson(confirmed), through,
      action === undefined ? null : stableJson(action), history === undefined ? null : stableJson(history)],
  })
}

function initialize(db: OpfsSAHPoolDatabase, input: InitialConfirmation<unknown, unknown, unknown>) {
  const { sessionId, confirmed, metadata, history } = input
  if (!validSnapshot(confirmed) || confirmed.revision !== 0 || confirmed.terminal) {
    throw new RecoveryStorageError('storage-failed', 'Initial confirmation must be an active revision zero')
  }
  db.transaction('IMMEDIATE', tx => {
    tx.exec({
      sql: 'INSERT INTO matches (session_id, version_hash, current_revision, metadata) VALUES (?, ?, ?, ?)',
      bind: [sessionId, confirmed.versionHash, confirmed.revision, stableJson(metadata)],
    })
    insertPoint(tx, sessionId, confirmed, 0, undefined, history)
  })
}

function register(db: OpfsSAHPoolDatabase, match: Row, summary: CommandRequestSummary): Row {
  const { key, versionHash, expectedRevision, requestDigest } = summary
  checkHash(versionHash, match.version_hash)
  const previous = commandRow(db, key)
  if (previous) {
    checkHash(previous.version_hash, versionHash)
    if (previous.request_digest !== requestDigest || previous.expected_revision !== expectedRevision ||
      previous.confirmation_revision !== null) {
      throw new RecoveryStorageError('storage-failed', 'Command registration conflicts with the durable record')
    }
    return previous
  }
  db.exec({
    sql: `INSERT INTO commands (session_id, version_hash, seat_id, command_id, ordinal, request_digest, expected_revision)
          SELECT ?, ?, ?, ?, COALESCE(MAX(ordinal), 0) + 1, ?, ? FROM commands WHERE session_id = ?`,
    bind: [key.sessionId, versionHash, key.seatId, key.commandId, requestDigest, expectedRevision, key.sessionId],
  })
  return commandRow(db, key) ?? incomplete()
}

function recordRejection(db: OpfsSAHPoolDatabase, summary: CommandRequestSummary) {
  db.transaction('IMMEDIATE', tx => {
    register(tx, activeMatch(tx, summary.key.sessionId), summary)
  })
}

function confirm(db: OpfsSAHPoolDatabase, confirmation: CommandConfirmation<unknown>) {
  const { previous, next, action, receipt, history } = confirmation
  const { sessionId, seatId, commandId } = receipt.key
  if (!validSnapshot(previous) || previous.terminal || !validSnapshot(next) ||
    next.revision !== previous.revision + 1 || receipt.expectedRevision !== previous.revision ||
    typeof action !== 'object' || action === null) {
    throw new RecoveryStorageError('storage-failed', 'Invalid match confirmation')
  }
  db.transaction('IMMEDIATE', tx => {
    const match = activeMatch(tx, sessionId)
    checkHash(previous.versionHash, match.version_hash)
    checkHash(next.versionHash, match.version_hash)
    if (match.current_revision !== previous.revision ||
      pointRow(tx, sessionId, previous.revision).snapshot !== stableJson(previous)) {
      throw new RecoveryStorageError('storage-failed', 'Match confirmation does not extend the durable snapshot')
    }
    register(tx, match, receipt)
    tx.exec({
      sql: 'UPDATE commands SET confirmation_revision = ?, result = ? WHERE session_id = ? AND seat_id = ? AND command_id = ?',
      bind: [next.revision, stableJson(receipt.result), sessionId, seatId, commandId],
    })
    const through = tx.selectValue('SELECT MAX(ordinal) FROM commands WHERE session_id = ?', [sessionId])
    if (!revision(through)) return incomplete()
    insertPoint(tx, sessionId, next, through, action, history)
    tx.exec({
      sql: 'UPDATE matches SET current_revision = ?, outcome = ? WHERE session_id = ?',
      bind: [next.revision, next.terminal ? stableJson(next.outcome) : null, sessionId],
    })
  })
}

function send(response: RecoveryWorkerResponse): void {
  port.postMessage(response)
}

port.onmessage = async ({ data: request }: MessageEvent<RecoveryWorkerRequest>) => {
  const { id } = request
  try {
    if (request.operation === 'open') {
      if (lease) throw new RecoveryStorageError('occupied', 'Match worker already has a writer lease')
      let opened = false
      lease = holdDatabase(() => {
        send({ id, ok: true, value: undefined })
        opened = true
      })
      try {
        await lease
      } catch (error) {
        if (!opened) throw error
        // Close reports cleanup errors through its own response.
      } finally {
        lease = undefined
      }
      return
    }
    if (!database || !releaseLock) throw new RecoveryStorageError('closed', 'Match recovery storage is not open')
    let value: Extract<RecoveryWorkerResponse, { ok: true }>['value']
    switch (request.operation) {
      case 'close': {
        const closed = lease
        const release = releaseLock
        releaseLock = undefined
        release()
        await closed
        break
      }
      case 'initialize':
        initialize(database, request.input)
        break
      case 'listSessions':
        value = listSessions(database)
        break
      case 'loadLatest':
        value = loadLatest(database, request.sessionId)
        break
      case 'readOutcome':
        value = readOutcome(database, request.sessionId)
        break
      case 'readHistory':
        value = readHistory(database, request.sessionId)
        break
      case 'lookup':
        value = lookup(database, request.key)
        break
      case 'recordRejection':
        recordRejection(database, request.summary)
        break
      case 'confirm':
        confirm(database, request.confirmation)
        break
    }
    send({ id, ok: true, value })
  } catch (error) {
    if (error instanceof MatchRecoveryError) send({ id, ok: false, reason: error.reason })
    else send({
      id, ok: false, code: error instanceof RecoveryStorageError ? error.code : 'storage-failed',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
