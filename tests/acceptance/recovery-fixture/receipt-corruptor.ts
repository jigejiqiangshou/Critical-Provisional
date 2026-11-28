import sqlite3InitModule from '@sqlite.org/sqlite-wasm'

const port = self as unknown as Pick<MessagePort, 'onmessage' | 'postMessage'>

port.onmessage = async ({ data }) => {
  try {
    // Alter the on-disk record after the production writer has shut down.
    await navigator.locks.request('critical-provisional:match-writer', async () => {
      const sqlite = await sqlite3InitModule()
      const pool = await sqlite.installOpfsSAHPoolVfs({
        name: 'critical-match-sahpool',
        directory: '.critical-provisional-matches',
        preserveOnInitFailure: true,
      })
      const db = new pool.OpfsSAHPoolDb('/matches.sqlite3')
      try {
        if (data === 'delete-receipt') {
          db.exec({
            sql: 'DELETE FROM commands WHERE session_id = ? AND command_id = ?',
            bind: ['persistent-session', 'opening'],
          })
        } else if (data === 'invalidate-action') {
          db.exec({
            sql: 'UPDATE confirmations SET action = ? WHERE session_id = ? AND revision = ?',
            bind: ['{}', 'persistent-session', 1],
          })
        } else {
          throw new Error('Unknown recovery corruption')
        }
        if (db.changes() !== 1) throw new Error('The confirmed record was absent before corruption')
      } finally {
        db.close()
        pool.pauseVfs()
      }
    })
    port.postMessage('ok')
  } catch (error) {
    port.postMessage(String(error))
  }
}
