type FrontendPackageV1 = {
  readonly formatVersion: 1
  readonly id: string
  readonly version: string
  readonly name: string
  readonly protocolMajor: number
  readonly protocolMinMinor: number
  readonly entryHtml: string
}

// Loads visibly inside the candidate iframe, but never starts the instance handshake.
const noHandshakeEntry = '<!doctype html><meta charset="utf-8"><title>T017 silent candidate</title><p>Entry loaded</p>'

export function frontendInstallPackages(initialEntry: string, upgradedEntry: string) {
  const initial: FrontendPackageV1 = {
    formatVersion: 1,
    id: 'test.frontend-install',
    version: '1.0.0',
    name: 'Frontend install acceptance',
    protocolMajor: 1,
    protocolMinMinor: 0,
    entryHtml: initialEntry,
  }
  const upgrade: FrontendPackageV1 = {
    ...initial,
    version: '1.1.0',
    entryHtml: upgradedEntry,
  }

  return {
    initial,
    upgrade,
    differentId: { ...upgrade, id: 'test.unrelated-frontend' },
    equalVersion: { ...upgrade, version: initial.version },
    olderVersion: { ...upgrade, version: '0.9.0' },
    incompatibleMajor: { ...upgrade, protocolMajor: 2 },
    incompatibleMinor: { ...upgrade, protocolMinMinor: 1 },
    silentInitial: { ...initial, entryHtml: noHandshakeEntry },
    silentUpgrade: { ...upgrade, entryHtml: noHandshakeEntry },
  } as const
}

export function frontendInstallFile(pack: FrontendPackageV1) {
  return {
    name: `${pack.id}-${pack.version}.critical-ui`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(pack), 'utf8'),
  }
}
