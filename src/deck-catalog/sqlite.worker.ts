/// <reference types="vite/client" />
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import type { OpfsSAHPoolDatabase } from '@sqlite.org/sqlite-wasm'
import { CatalogStorageError } from './catalog-errors'
import type {
  CardKind, CatalogStorageErrorCode, CatalogWorkerRequest, CatalogWorkerResponse,
  DeckEntry, JsonObject, Release, ReleaseSummary,
} from './catalog'
import schema from './schema.sql?raw'

const port = self as unknown as Pick<MessagePort, 'onmessage' | 'postMessage'>
const lockName = 'critical-provisional:catalog-writer'
const schemaVersion = 1
const SQLITE_FULL = 13
const SQLITE_CONSTRAINT = 19
let database: OpfsSAHPoolDatabase | undefined
let lease: Promise<void> | undefined
let releaseLock: (() => void) | undefined

function send(response: CatalogWorkerResponse) {
  port.postMessage(response)
}

function reportError(id: number, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof CatalogStorageError) {
    send({ id, ok: false, code: error.code, message })
    return
  }
  const result = typeof error === 'object' && error !== null && 'resultCode' in error
    && typeof error.resultCode === 'number' ? error.resultCode & 0xff : undefined
  let code: CatalogStorageErrorCode = 'storage-failed'
  if (result === SQLITE_FULL || (error instanceof DOMException && error.name === 'QuotaExceededError')
    || /(?:storage )?quota|disk is full/i.test(message)) {
    code = 'quota-exceeded'
  } else if (result === SQLITE_CONSTRAINT) {
    code = 'invalid-release'
  }
  send({ id, ok: false, code, message })
}

function initialize(db: OpfsSAHPoolDatabase) {
  db.exec('PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON;')
  const version = db.selectValue('PRAGMA user_version')
  if (version === schemaVersion) return
  if (version !== 0) throw new CatalogStorageError('unavailable', `Unsupported catalog schema version ${version}`)
  db.transaction('IMMEDIATE', (tx) => {
    tx.exec(schema)
    tx.exec(`PRAGMA user_version = ${schemaVersion}`)
  })
}

async function holdDatabase(onReady: () => void) {
  if (!navigator.locks || !navigator.storage?.getDirectory) {
    throw new CatalogStorageError('unavailable', 'Web Locks and OPFS are required to open the catalog')
  }
  await navigator.locks.request(lockName, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
    if (!lock) throw new CatalogStorageError('occupied', 'Another app instance holds the catalog writer lock')
    const sqlite = await sqlite3InitModule()
    const pool = await sqlite.installOpfsSAHPoolVfs({
      name: 'critical-catalog-sahpool',
      directory: '.critical-provisional-catalog',
      preserveOnInitFailure: true,
    })
    try {
      const db = new pool.OpfsSAHPoolDb('/catalog.sqlite3')
      database = db
      initialize(db)
      const closed = new Promise<void>((resolve) => { releaseLock = resolve })
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

function getRelease(db: OpfsSAHPoolDatabase, releaseId: string): Release | undefined {
  const meta = db.selectObject('SELECT rules_version FROM releases WHERE id = ? AND sealed = 1', [releaseId])
  if (!meta) return undefined
  const cards = db.selectObjects(
    'SELECT id, name, kind, flagship, data FROM release_cards WHERE release_id = ? ORDER BY id',
    [releaseId],
  ).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    kind: row.kind as CardKind,
    flagship: row.flagship === 1,
    data: JSON.parse(row.data as string) as JsonObject,
  }))
  const entriesByPreset = new Map<string, DeckEntry[]>()
  for (const row of db.selectObjects(
    'SELECT preset_id, card_id, quantity FROM release_preset_entries WHERE release_id = ? ORDER BY preset_id, position',
    [releaseId],
  )) {
    const id = row.preset_id as string
    const entries = entriesByPreset.get(id) ?? []
    entries.push({ cardId: row.card_id as string, quantity: row.quantity as number })
    entriesByPreset.set(id, entries)
  }
  const presets = db.selectObjects(
    'SELECT id, name FROM release_presets WHERE release_id = ? ORDER BY id',
    [releaseId],
  ).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    entries: entriesByPreset.get(row.id as string) ?? [],
  }))
  return { id: releaseId, rulesVersion: meta.rules_version as string, cards, presets }
}

function listReleases(db: OpfsSAHPoolDatabase): ReleaseSummary[] {
  return db.selectObjects('SELECT id, rules_version FROM releases WHERE sealed = 1 ORDER BY id')
    .map((row) => ({ id: row.id as string, rulesVersion: row.rules_version as string }))
}

function invalidRelease(message: string): never {
  throw new CatalogStorageError('invalid-release', message)
}

function nonblank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function encodeCardData(value: JsonObject): string {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) invalidRelease('Card data must be a JSON object')
  try {
    return JSON.stringify(value, function (this: Record<string, unknown>, key: string) {
      // Inspect the original child so a Date translated by toJSON cannot enter the catalog.
      const child = this[key]
      const object = child !== null && typeof child === 'object'
      if (child === null || typeof child === 'string' || typeof child === 'boolean' || Number.isFinite(child)
        || (object && (Array.isArray(child) || Object.getPrototypeOf(child) === Object.prototype))) return child
      invalidRelease('Card data must contain only JSON values')
    })
  } catch (error) {
    invalidRelease(error instanceof Error ? error.message : 'Card data could not be encoded')
  }
}

function writeRelease(db: OpfsSAHPoolDatabase, release: Release) {
  if (!release || !nonblank(release.id) || !nonblank(release.rulesVersion)
    || !Array.isArray(release.cards) || !Array.isArray(release.presets)) {
    invalidRelease('Release ID, rules version, cards, and presets are required')
  }
  db.transaction('IMMEDIATE', (tx) => {
    if (tx.selectValue('SELECT 1 FROM releases WHERE id = ?', [release.id])) {
      throw new CatalogStorageError('release-exists', `Release ${release.id} already exists`)
    }
    tx.exec({ sql: 'INSERT INTO releases (id, rules_version) VALUES (?, ?)', bind: [release.id, release.rulesVersion] })
    for (const card of release.cards) {
      if (!card || !nonblank(card.id) || !nonblank(card.name) || typeof card.flagship !== 'boolean') {
        invalidRelease('Card ID, name, and flagship status are required')
      }
      if (!(card.kind === 'unit' || card.kind === 'spell' || card.kind === 'trap' || card.kind === 'ace')) {
        invalidRelease(`Card ${card.id} has an unsupported kind`)
      }
      tx.exec({ sql: 'INSERT INTO card_identities (id) VALUES (?) ON CONFLICT DO NOTHING', bind: [card.id] })
      tx.exec({
        sql: 'INSERT INTO release_cards (release_id, id, name, kind, flagship, data) VALUES (?, ?, ?, ?, ?, ?)',
        bind: [release.id, card.id, card.name, card.kind, Number(card.flagship), encodeCardData(card.data)],
      })
    }
    for (const preset of release.presets) {
      if (!preset || !nonblank(preset.id) || !nonblank(preset.name) || !Array.isArray(preset.entries)) {
        invalidRelease('Preset ID, name, and entries are required')
      }
      tx.exec({
        sql: 'INSERT INTO release_presets (release_id, id, name) VALUES (?, ?, ?)',
        bind: [release.id, preset.id, preset.name],
      })
      for (const [position, entry] of preset.entries.entries()) {
        if (!entry || !nonblank(entry.cardId) || !Number.isSafeInteger(entry.quantity) || entry.quantity < 1) {
          invalidRelease('Preset entries require a card ID and positive safe-integer quantity')
        }
        tx.exec({
          sql: 'INSERT INTO release_preset_entries (release_id, preset_id, position, card_id, quantity) VALUES (?, ?, ?, ?, ?)',
          bind: [release.id, preset.id, position, entry.cardId, entry.quantity],
        })
      }
    }
    tx.exec({ sql: 'UPDATE releases SET sealed = 1 WHERE id = ?', bind: [release.id] })
  })
}

port.onmessage = async ({ data: request }: MessageEvent<CatalogWorkerRequest>) => {
  const { id } = request
  try {
    if (request.operation === 'open') {
      if (lease) throw new CatalogStorageError('occupied', 'Catalog worker already has a writer lease')
      let opened = false
      lease = holdDatabase(() => {
        send({ id, ok: true, value: undefined })
        opened = true
      })
      try {
        await lease
      } catch (error) {
        if (!opened) throw error
        // After opening, close reports cleanup errors through its own request.
      } finally {
        lease = undefined
      }
      return
    }
    if (!database || !releaseLock) throw new CatalogStorageError('closed', 'Catalog storage is not open')
    switch (request.operation) {
      case 'close':
        releaseLock()
        await lease
        send({ id, ok: true, value: undefined })
        break
      case 'getRelease':
        send({ id, ok: true, value: getRelease(database, request.releaseId) })
        break
      case 'listReleases':
        send({ id, ok: true, value: listReleases(database) })
        break
      case 'writeRelease':
        writeRelease(database, request.release)
        send({ id, ok: true, value: undefined })
        break
    }
  } catch (error) {
    reportError(id, error)
  }
}
