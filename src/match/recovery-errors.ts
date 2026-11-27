export type RecoveryStorageErrorCode = 'unavailable' | 'occupied' | 'closed' | 'storage-failed'

export class RecoveryStorageError extends Error {
  constructor(readonly code: RecoveryStorageErrorCode, message: string) {
    super(message)
    this.name = 'RecoveryStorageError'
  }
}
