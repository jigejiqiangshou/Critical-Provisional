import { PLAYER_PROTOCOL_V1, negotiatePlayerProtocol } from '../../match/player-protocol'
import type { ProtocolRange } from '../../match/player-protocol'
import type { FrontendCandidate, FrontendManifest, FrontendPackageStore, Installation } from './package-store'

// T004 measured this many bytes on Chromium. T049 replaces it with the verified release limit.
export const MAX_FRONTEND_PACKAGE_BYTES = 10_932_804
export const OFFICIAL_FRONTEND_IDS = ['critical.official-2d', 'critical.official-3d'] as const

export type FrontendInstallErrorCode =
  | 'package-too-large'
  | 'package-corrupt'
  | 'format-incompatible'
  | 'resource-missing'
  | 'protocol-incompatible'
  | 'id-conflict'
  | 'upgrade-id-mismatch'
  | 'upgrade-version-not-newer'
  | 'not-installed'
  | 'source-mismatch'
  | 'space-insufficient'
  | 'storage-failed'
  | 'candidate-closed'

export class FrontendInstallError extends Error {
  constructor(readonly code: FrontendInstallErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'FrontendInstallError'
  }
}

export interface FrontendInstallSource {
  readonly manifest: FrontendManifest
  readonly fileName?: string
  readonly upgradeFrom?: Installation
}

export type ConfirmFrontendSource = (source: FrontendInstallSource) => boolean | Promise<boolean>

export interface CandidateCheck {
  readonly closed?: boolean
  close(): void
}

export type CheckFrontendCandidate = (entry: FrontendCandidate) => Promise<CandidateCheck>

export interface OfficialFrontendRecord {
  readonly version: string
  readonly integrity: string
}

export interface FrontendInstallerOptions {
  readonly versions?: ProtocolRange
  readonly maxPackageBytes?: number
  /** Release integrity records supplied by the trusted host, never read from an imported file. */
  readonly officialManifest?: ReadonlyMap<string, OfficialFrontendRecord>
}

interface ParsedPackage {
  readonly manifest: FrontendManifest
  readonly entryHtml: string
  readonly bytes: ArrayBuffer
}

const packageIdPattern = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const numericPattern = /^\d+$/

function parseVersion(version: string): { core: string[]; prerelease?: string[] } | undefined {
  const match = semverPattern.exec(version)
  if (!match) return undefined
  const prerelease = match[4]?.split('.')
  if (prerelease?.some(part => /^0\d+$/.test(part))) return undefined
  return { core: match.slice(1, 4), prerelease }
}

function compareNumeric(one: string, other: string): number {
  return one.length - other.length || (one === other ? 0 : one < other ? -1 : 1)
}

function isNewerVersion(version: string, previous: string): boolean {
  const next = parseVersion(version)
  const prior = parseVersion(previous)
  if (!next || !prior) return false
  for (const [index, part] of next.core.entries()) {
    const difference = compareNumeric(part, prior.core[index])
    if (difference) return difference > 0
  }
  if (!next.prerelease) return Boolean(prior.prerelease)
  if (!prior.prerelease) return false
  for (const [index, part] of next.prerelease.entries()) {
    const other = prior.prerelease[index]
    if (other === undefined) return true
    if (part === other) continue
    const number = numericPattern.test(part)
    const otherNumber = numericPattern.test(other)
    if (number !== otherNumber) return !number
    return number ? compareNumeric(part, other) > 0 : part > other
  }
  return false
}

function embeddedResource(value: string): boolean {
  return /^(data:|#)/i.test(value.trim())
}

function assertEmbeddedCss(css: string): void {
  if (/@import\b/i.test(css)) {
    throw new FrontendInstallError('resource-missing', '前端包有未内嵌的样式资源')
  }
  for (const [, , resource] of css.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gis)) {
    if (!embeddedResource(resource)) {
      throw new FrontendInstallError('resource-missing', '前端包有未内嵌的样式资源')
    }
  }
}

function embeddedSourceSet(value: string): boolean {
  // URL tokens may themselves contain commas, including the required data URL delimiter.
  // A trailing comma ends a token, while a descriptor ends at the next comma.
  let remaining = value.trim()
  while (remaining) {
    const url = /^\S+/.exec(remaining)![0]
    if (!embeddedResource(url)) return false
    remaining = remaining.slice(url.length).trimStart()
    if (url.endsWith(',')) continue
    const separator = remaining.indexOf(',')
    if (separator < 0) return true
    remaining = remaining.slice(separator + 1).trimStart()
  }
  return true
}

function checkEmbeddedEntry(html: string): void {
  // Template content is inert. Reading an import must not start scripts or load its resources.
  const template = document.createElement('template')
  template.innerHTML = html
  const fragments = [template.content]
  for (const fragment of fragments) {
    for (const element of fragment.querySelectorAll('*')) {
      const tag = element.localName.toLowerCase()
      if (tag === 'iframe' || tag === 'frame' || tag === 'base' || tag === 'object' || tag === 'embed' ||
          (tag === 'meta' && element.getAttribute('http-equiv')?.trim().toLowerCase() === 'refresh')) {
        throw new FrontendInstallError('resource-missing', '前端入口使用了不受支持的嵌入资源或导航')
      }
      for (const name of ['src', 'poster', 'background', 'href', 'xlink:href', 'srcset', 'imagesrcset']) {
        const value = element.getAttribute(name)
        if (value === null) continue
        const embedded = name.endsWith('srcset') ? embeddedSourceSet(value) : embeddedResource(value)
        if (!embedded || (tag === 'script' && name === 'src') ||
            (name === 'href' && tag === 'link' && element.getAttribute('rel')?.toLowerCase().includes('stylesheet'))) {
          throw new FrontendInstallError('resource-missing', '前端包有未内嵌或不受支持的入口资源')
        }
      }
      if (tag === 'style') assertEmbeddedCss(element.textContent ?? '')
      const style = element.getAttribute('style')
      if (style) assertEmbeddedCss(style)
      if (element instanceof HTMLTemplateElement) fragments.push(element.content)
    }
  }
}

async function parsePackage(file: Blob, maxBytes: number, versions: ProtocolRange): Promise<ParsedPackage> {
  if (file.size > maxBytes) {
    throw new FrontendInstallError('package-too-large', `前端包超过 ${maxBytes} 字节上限`)
  }
  let data: unknown
  let bytes: ArrayBuffer
  try {
    bytes = await file.arrayBuffer()
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch (cause) {
    throw new FrontendInstallError('package-corrupt', '前端包无法读取或不是有效的 UTF-8 JSON 文件', { cause })
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new FrontendInstallError('package-corrupt', '前端包缺少清单')
  }
  const { formatVersion, id, version, name, protocolMajor, protocolMinMinor, entryHtml } =
    data as Record<string, unknown>
  if (typeof formatVersion === 'number' && formatVersion !== 1) {
    throw new FrontendInstallError('format-incompatible', '前端包格式版本不受支持')
  }
  if (formatVersion !== 1 || typeof id !== 'string' || !packageIdPattern.test(id) || typeof version !== 'string' ||
      !parseVersion(version) || typeof name !== 'string' || !name.trim() ||
      typeof protocolMajor !== 'number' || !Number.isSafeInteger(protocolMajor) || protocolMajor < 1 ||
      typeof protocolMinMinor !== 'number' || !Number.isSafeInteger(protocolMinMinor) || protocolMinMinor < 0) {
    throw new FrontendInstallError('package-corrupt', '前端包清单包含无效字段')
  }
  if (typeof entryHtml !== 'string' || !entryHtml.trim()) {
    throw new FrontendInstallError('resource-missing', '前端包缺少入口 HTML')
  }
  const negotiation = negotiatePlayerProtocol(versions, {
    major: protocolMajor,
    minMinor: protocolMinMinor,
    maxMinor: Number.MAX_SAFE_INTEGER,
  })
  if (negotiation.type === 'handshake-rejected') {
    throw new FrontendInstallError('protocol-incompatible', `前端包协议不兼容 (${negotiation.reason})`)
  }
  checkEmbeddedEntry(entryHtml)
  return { manifest: Object.freeze({ formatVersion, id, version, name, protocolMajor, protocolMinMinor }), entryHtml, bytes }
}

async function assertStorageSpace(bytes: number): Promise<void> {
  // The browser can withhold estimates. The durable transaction still handles actual quota failures.
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined)
  if (estimate?.quota !== undefined && estimate.usage !== undefined && estimate.quota - estimate.usage < bytes) {
    throw new FrontendInstallError('space-insufficient', '前端包存储空间不足')
  }
}

async function storeOperation<Value>(operation: () => Promise<Value>): Promise<Value> {
  try {
    return await operation()
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'QuotaExceededError') {
      throw new FrontendInstallError('space-insufficient', '前端包存储空间不足', { cause })
    }
    throw new FrontendInstallError('storage-failed', '前端包存储操作失败', { cause })
  }
}

function closeCheck(check: CandidateCheck | undefined): void {
  try { check?.close() } catch { /* A cleanup callback must not replace the transaction result. */ }
}

export class FrontendInstaller {
  private readonly versions: ProtocolRange
  private readonly maxBytes: number
  private readonly officialManifest: ReadonlyMap<string, OfficialFrontendRecord>
  private readonly reservedIds: ReadonlySet<string>

  constructor(
    private readonly store: FrontendPackageStore,
    private readonly checkCandidate: CheckFrontendCandidate,
    options: FrontendInstallerOptions = {},
  ) {
    this.versions = options.versions ?? PLAYER_PROTOCOL_V1
    this.maxBytes = options.maxPackageBytes ?? MAX_FRONTEND_PACKAGE_BYTES
    this.officialManifest = new Map(options.officialManifest)
    this.reservedIds = new Set([...OFFICIAL_FRONTEND_IDS, ...this.officialManifest.keys()])
  }

  async install(file: Blob, confirmSource: ConfirmFrontendSource): Promise<Installation | undefined> {
    const candidate = await parsePackage(file, this.maxBytes, this.versions)
    const { id } = candidate.manifest
    if (this.reservedIds.has(id)) throw this.idConflict(id)
    const current = await storeOperation(() => this.store.get(id))
    if (current) throw this.idConflict(id)
    await assertStorageSpace(file.size)
    if (!await confirmSource({ manifest: candidate.manifest, fileName: this.fileName(file) })) return undefined
    return this.store.withPackage(id, async () => {
      if (await storeOperation(() => this.store.get(id))) throw this.idConflict(id)
      return this.publish(candidate, 'third-party')
    })
  }

  async upgrade(id: string, file: Blob, confirmSource: ConfirmFrontendSource): Promise<Installation | undefined> {
    const candidate = await parsePackage(file, this.maxBytes, this.versions)
    const current = await storeOperation(() => this.store.get(id))
    this.assertUpgrade(id, candidate.manifest, current)
    await assertStorageSpace(file.size)
    if (!await confirmSource({ manifest: candidate.manifest, fileName: this.fileName(file), upgradeFrom: current })) {
      return undefined
    }
    return this.store.withPackage(id, async () => {
      const prior = await storeOperation(() => this.store.get(id))
      this.assertUpgrade(id, candidate.manifest, prior)
      if (prior.entryKey !== current.entryKey) {
        throw new FrontendInstallError('source-mismatch', '活动版本在确认期间变化，请重新选择升级包')
      }
      return this.publish(candidate, 'third-party', prior)
    })
  }

  async installOfficial(file: Blob): Promise<Installation> {
    const candidate = await parsePackage(file, this.maxBytes, this.versions)
    const { id, version } = candidate.manifest
    const expected = this.officialManifest.get(id)
    if (!expected || expected.version !== version) {
      throw new FrontendInstallError('source-mismatch', '官方前端包与主体发行清单不符')
    }
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', candidate.bytes))
    const integrity = 'sha256-' + btoa(String.fromCharCode(...digest))
    if (integrity !== expected.integrity) {
      throw new FrontendInstallError('source-mismatch', '官方前端包完整性校验失败')
    }
    return this.store.withPackage(id, async () => {
      const prior = await storeOperation(() => this.store.get(id))
      if (prior?.source === 'third-party') throw this.idConflict(id)
      if (prior && !isNewerVersion(version, prior.manifest.version)) return prior
      await assertStorageSpace(file.size)
      return this.publish(candidate, 'official', prior)
    })
  }

  async uninstall(id: string): Promise<boolean> {
    return storeOperation(() => this.store.withPackage(id, () => this.store.remove(id)))
  }

  private fileName(file: Blob): string | undefined {
    return typeof File !== 'undefined' && file instanceof File ? file.name : undefined
  }

  private idConflict(id: string): FrontendInstallError {
    return new FrontendInstallError('id-conflict', `前端包 ID 冲突：${id}`)
  }

  private assertUpgrade(id: string, manifest: FrontendManifest, current: Installation | undefined):
    asserts current is Installation {
    if (!current) throw new FrontendInstallError('not-installed', `前端包未安装：${id}`)
    if (current.source !== 'third-party' || this.reservedIds.has(id)) throw this.idConflict(id)
    if (manifest.id !== id) {
      throw new FrontendInstallError('upgrade-id-mismatch', `升级包 ID ${manifest.id} 与已选条目 ${id} 不符`)
    }
    if (!isNewerVersion(manifest.version, current.manifest.version)) {
      throw new FrontendInstallError('upgrade-version-not-newer', '升级包版本必须高于当前活动版本')
    }
  }

  private async publish(
    data: ParsedPackage,
    source: Installation['source'],
    prior?: Installation,
  ): Promise<Installation> {
    const candidate: FrontendCandidate = Object.freeze({
      manifest: data.manifest,
      entryKey: crypto.randomUUID(),
      instanceToken: crypto.randomUUID(),
    })
    await storeOperation(() => this.store.collect(data.manifest.id))
    await storeOperation(() => this.store.stage(candidate, data.entryHtml))
    let check: CandidateCheck | undefined
    let installed: Installation | undefined
    try {
      check = await this.checkCandidate(candidate)
      if (check.closed) throw new FrontendInstallError('candidate-closed', '前端候选实例在提交前结束')
      installed = await storeOperation(() => this.store.commit(candidate, prior, source))
      return installed
    } finally {
      closeCheck(check)
      // If storage becomes unavailable even for cleanup, the next import collects the inert staging entry.
      if (installed) await this.store.collect(candidate.manifest.id).catch(() => {})
      else await this.store.discard(candidate).catch(() => {})
    }
  }
}
