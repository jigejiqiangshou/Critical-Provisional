import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import type { OpfsSAHPoolDatabase } from '@sqlite.org/sqlite-wasm'

export type StorageSpikeCommand = 'open' | 'write' | 'rollback' | 'interrupt'

export type StorageSpikeMessage =
  | { status: 'ready' | 'written' | 'rolled-back' | 'uncommitted'; version: string; count: number }
  | { status: 'occupied' }
  | { status: 'error'; detail: string }

const port = self as unknown as Pick<MessagePort, 'onmessage' | 'postMessage'>
const lockName = 'critical-storage-spike-writer'
let database: OpfsSAHPoolDatabase | undefined
let version = ''
let opening = false
let interrupted = false

function send(message: StorageSpikeMessage) {
  port.postMessage(message)
}

function reportError(error: unknown) {
  send({ status: 'error', detail: error instanceof Error ? error.message : String(error) })
}

function recordCount(db: OpfsSAHPoolDatabase) {
  return Number(db.selectValue('SELECT count(*) FROM spike_record'))
}

async function open() {
  if (database || opening) return

  opening = true
  try {
    if (!navigator.locks || !navigator.storage?.getDirectory) {
      throw new Error('当前环境缺少 Web Locks 或 OPFS')
    }

    await navigator.locks.request(lockName, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock) {
        send({ status: 'occupied' })
        return
      }

      const sqlite = await sqlite3InitModule()
      const pool = await sqlite.installOpfsSAHPoolVfs({
        directory: '.critical-storage-spike',
        preserveOnInitFailure: true,
      })

      try {
        const db = new pool.OpfsSAHPoolDb('/device-verification.sqlite3')
        database = db
        version = sqlite.version.libVersion
        db.exec('CREATE TABLE IF NOT EXISTS spike_record (id INTEGER PRIMARY KEY)')
        send({ status: 'ready', version, count: recordCount(db) })

        // The dedicated worker holds this lease until its owning document closes.
        await new Promise<void>(() => {})
      } finally {
        database?.close()
        database = undefined
        pool.pauseVfs()
      }
    })
  } catch (error) {
    reportError(error)
  } finally {
    opening = false
  }
}

function operate(db: OpfsSAHPoolDatabase, command: Exclude<StorageSpikeCommand, 'open'>) {
  if (command === 'write') {
    db.transaction((tx) => tx.exec('INSERT INTO spike_record DEFAULT VALUES'))
    send({ status: 'written', version, count: recordCount(db) })
    return
  }

  if (command === 'interrupt') {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec('INSERT INTO spike_record DEFAULT VALUES')
      const count = recordCount(db)
      interrupted = true
      send({ status: 'uncommitted', version, count })
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return
  }

  const before = recordCount(db)
  try {
    db.transaction((tx) => {
      tx.exec('INSERT INTO spike_record DEFAULT VALUES')
      tx.exec('INSERT INTO spike_record (id) SELECT max(id) FROM spike_record')
    })
  } catch (error) {
    const count = recordCount(db)
    if (!(error instanceof Error) || !error.message.includes('UNIQUE constraint failed') || count !== before) {
      throw error
    }
    send({ status: 'rolled-back', version, count })
    return
  }
  throw new Error('重复主键未被拒绝')
}

port.onmessage = ({ data }: MessageEvent<StorageSpikeCommand>) => {
  if (data === 'open') {
    void open()
    return
  }
  if (!database || interrupted) return

  try {
    operate(database, data)
  } catch (error) {
    reportError(error)
  }
}
