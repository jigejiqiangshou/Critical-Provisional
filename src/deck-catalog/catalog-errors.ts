export type CatalogStorageErrorCode =
  | 'occupied'
  | 'unavailable'
  | 'quota-exceeded'
  | 'storage-failed'
  | 'release-exists'
  | 'invalid-release'
  | 'closed'

export class CatalogStorageError extends Error {
  constructor(readonly code: CatalogStorageErrorCode, message: string) {
    super(message)
    this.name = 'CatalogStorageError'
  }
}
