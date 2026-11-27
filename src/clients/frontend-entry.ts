export const frontendEntryPath = '__critical__/frontend-entry'
export const frontendEntryStore = 'entries'
export const frontendInstallationStore = 'installations'

export interface VerifiedFrontendEntry {
  key: string
  html: string
}

const entryTokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isFrontendEntryToken(value: string | null): value is string {
  return value !== null && entryTokenPattern.test(value)
}

/**
 * The launcher writes verified entries and installation records in one transaction.
 * Entries are keyed per package version and retained while their instances are in use.
 */
export function openFrontendDatabase(scope: URL): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('critical-frontend-installations:' + scope.pathname, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      database.createObjectStore(frontendEntryStore, { keyPath: 'key' })
      database.createObjectStore(frontendInstallationStore, { keyPath: 'key' })
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      resolve(database)
    }
  })
}

export async function readVerifiedFrontendEntry(scope: URL, key: string): Promise<VerifiedFrontendEntry | undefined> {
  const database = await openFrontendDatabase(scope)
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(frontendEntryStore).objectStore(frontendEntryStore).get(key)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
  } finally {
    database.close()
  }
}
