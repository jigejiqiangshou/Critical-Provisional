import type { FrontendConnection, PlayerInterface } from '../match/player-interface'
import { negotiatePlayerProtocol, parsePlayerMessage, parseProtocolRange, PLAYER_PROTOCOL_V1 } from '../match/player-protocol'
import type { ProtocolRange, ProtocolVersion, ServerMessage, ViewScope } from '../match/player-protocol'
import { frontendEntryUrl } from './offline-ready'

export interface InstalledFrontendTarget {
  readonly entryKey: string
  readonly manifest: {
    readonly name: string
    readonly protocolMajor: number
    readonly protocolMinMinor: number
  }
}

export interface CandidateFrontendTarget extends InstalledFrontendTarget {
  readonly instanceToken: string
}

export interface FrontendInstance {
  readonly iframe: HTMLIFrameElement
  readonly instanceToken: string
  readonly version: ProtocolVersion
  readonly closed: boolean
  close(): void
}

export interface PlayerFrontendBinding {
  readonly player: Pick<PlayerInterface<unknown>, 'connect' | 'authorize'>
  readonly scope: ViewScope
}

export interface FrontendHostOptions {
  readonly mount: HTMLElement
  readonly scope?: URL
  readonly versions?: ProtocolRange
  readonly timeoutMs?: number
}

type FrontendHostErrorCode =
  | 'entry-load-failed' | 'handshake-invalid' | 'handshake-timeout'
  | 'major-version-mismatch' | 'no-common-minor-version'
  | 'authorization-failed' | 'instance-closed'

export class FrontendHostError extends Error {
  constructor(readonly code: FrontendHostErrorCode) {
    super(code)
    this.name = 'FrontendHostError'
  }
}

const constrainedDocuments = new WeakMap<Document, string>()

function restrictFrameNavigation(document: Document, entry: URL) {
  const allowed = entry.origin + entry.pathname
  const existing = constrainedDocuments.get(document)
  if (existing === allowed) return
  if (existing !== undefined) throw new FrontendHostError('entry-load-failed')
  const policy = document.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = `frame-src ${allowed}; object-src 'none'`
  document.head.append(policy)
  constrainedDocuments.set(document, allowed)
}

interface Probe {
  readonly result: Promise<boolean>
  close(): void
}

function probeEntry(controller: ServiceWorker, key: string, instance: string, candidate: boolean): Probe {
  const { port1, port2 } = new MessageChannel()
  let cancel: () => void
  const result = new Promise<boolean>(resolve => {
    cancel = () => resolve(false)
    port1.onmessage = ({ data }) => resolve(data === true)
    port1.onmessageerror = () => resolve(false)
    try {
      controller.postMessage({ type: 'critical.frontend-entry-prepare', key, instance, candidate }, [port2])
    } catch {
      port2.close()
      resolve(false)
    }
  })
  return { result, close: () => { port1.close(); cancel() } }
}

export class FrontendHost {
  readonly #mount: HTMLElement
  readonly #scope: URL
  readonly #versions: ProtocolRange
  readonly #timeoutMs: number

  constructor({ mount, scope = new URL('./', mount.ownerDocument.baseURI), versions = PLAYER_PROTOCOL_V1, timeoutMs = 10_000 }: FrontendHostOptions) {
    const hostVersions = parseProtocolRange(versions)
    if (!hostVersions) throw new TypeError('Invalid frontend host protocol range')
    this.#mount = mount
    this.#scope = new URL(scope.href)
    this.#versions = hostVersions
    this.#timeoutMs = timeoutMs
  }

  readonly checkCandidate = async (target: CandidateFrontendTarget): Promise<FrontendInstance> => {
    return await this.#start(target, target.instanceToken)
  }

  async openInstalled(
    target: InstalledFrontendTarget,
    binding: PlayerFrontendBinding,
    onClose?: () => void,
    signal?: AbortSignal,
  ): Promise<FrontendInstance> {
    let released = false
    const release = () => {
      if (released) return
      released = true
      onClose?.()
    }
    try {
      return await this.#start(target, crypto.randomUUID(), binding, signal, release)
    } catch (error) {
      release()
      throw error
    }
  }

  async #start(
    target: InstalledFrontendTarget,
    instance: string,
    binding?: PlayerFrontendBinding,
    signal?: AbortSignal,
    release?: () => void,
  ): Promise<FrontendInstance> {
    if (signal?.aborted) throw new FrontendHostError('instance-closed')
    const document = this.#mount.ownerDocument
    const window = document.defaultView
    const workers = window?.navigator.serviceWorker
    const controller = workers?.controller
    if (!window || !workers || !controller || !this.#mount.isConnected ||
      controller.scriptURL !== new URL('service-worker.js', this.#scope).href) {
      throw new FrontendHostError('entry-load-failed')
    }

    const { entryKey, manifest } = target
    let entry: URL
    try {
      entry = frontendEntryUrl(entryKey, instance, this.#scope)
    } catch {
      throw new FrontendHostError('entry-load-failed')
    }
    restrictFrameNavigation(document, entry)

    const iframe = document.createElement('iframe')
    iframe.title = manifest.name
    iframe.hidden = binding === undefined
    iframe.referrerPolicy = 'no-referrer'
    // Chromium routes the initial same-origin navigation through the worker.
    // The response applies its own opaque sandbox before package code executes.
    iframe.sandbox.add('allow-scripts', 'allow-same-origin')
    iframe.src = entry.href

    const ports = new MessageChannel()
    const probe = probeEntry(controller, entryKey, instance, binding === undefined)

    return await new Promise<FrontendInstance>((resolve, reject) => {
      let closed = false
      let loaded = false
      let ready = false
      let handedOff = false
      let negotiating = false
      let negotiated = false
      let connection: FrontendConnection | undefined

      const close = (code: FrontendHostErrorCode = 'instance-closed') => {
        if (closed) return
        closed = true
        window.clearTimeout(timer)
        observer.disconnect()
        window.removeEventListener('message', receiveReady)
        window.removeEventListener('pagehide', leave)
        workers.removeEventListener('controllerchange', controlChanged)
        signal?.removeEventListener('abort', leave)
        probe.close()
        connection?.close()
        ports.port1.close()
        if (!handedOff) ports.port2.close()
        iframe.remove()
        reject(new FrontendHostError(code))
        release?.()
      }

      const leave = () => close()
      const controlChanged = () => {
        if (workers.controller !== controller) close('entry-load-failed')
      }
      const sendPort = () => {
        if (closed || !loaded || !ready || handedOff) return
        const frame = iframe.contentWindow
        if (!frame || workers.controller !== controller) return close('entry-load-failed')
        try {
          frame.postMessage({ type: 'critical.frontend-connect', instance }, '*', [ports.port2])
          handedOff = true
        } catch {
          close('handshake-invalid')
        }
      }
      const receiveReady = (event: MessageEvent) => {
        if (closed || event.source !== iframe.contentWindow || event.data?.type !== 'critical.frontend-ready') return
        if (event.origin !== 'null' || event.data.instance !== instance || ready) return close('handshake-invalid')
        ready = true
        sendPort()
      }

      const timer = window.setTimeout(() => close(loaded ? 'handshake-timeout' : 'entry-load-failed'), this.#timeoutMs)
      const observer = new MutationObserver(records => {
        const removed = records.some(record => Array.from(record.removedNodes).some(node => node.contains(iframe)))
        if (removed || !iframe.isConnected || iframe.parentNode !== this.#mount) close()
      })

      iframe.addEventListener('load', () => {
        if (loaded) return close()
        loaded = true
        // Subsequent navigations must stay opaque even when their response fails.
        iframe.sandbox.remove('allow-same-origin')
        sendPort()
      })
      iframe.addEventListener('error', () => close('entry-load-failed'))
      ports.port1.addEventListener('messageerror', () => close('handshake-invalid'))
      ports.port1.addEventListener('close', () => close())
      const negotiate = async (data: unknown) => {
        negotiating = true
        const hello = parsePlayerMessage(data)
        if (hello?.type !== 'hello') return close('handshake-invalid')
        const result = negotiatePlayerProtocol(this.#versions, hello.versions)
        if (result.type === 'handshake-rejected') {
          ports.port1.postMessage(result)
          return close(result.reason)
        }
        if (result.version.major !== manifest.protocolMajor) return close('major-version-mismatch')
        if (result.version.minor < manifest.protocolMinMinor) return close('no-common-minor-version')

        if (binding !== undefined) {
          let welcome: ServerMessage | undefined
          try {
            connection = binding.player.connect(instance, {
              send: message => {
                if (negotiated) ports.port1.postMessage(message)
                else welcome = message
              },
              close: () => {
                ports.port1.onmessage = null
                ports.port1.close()
              },
            })
            await connection.receive(hello)
            if (closed) return
            if (welcome?.type === 'handshake-rejected') return close(welcome.reason)
            if (welcome?.type !== 'welcome' || welcome.version.major !== result.version.major ||
              welcome.version.minor !== result.version.minor || !binding.player.authorize(connection, binding.scope)) {
              return close('authorization-failed')
            }
          } catch {
            return close('authorization-failed')
          }
        }

        negotiated = true
        window.clearTimeout(timer)
        window.removeEventListener('message', receiveReady)
        ports.port1.postMessage(result)
        resolve({ iframe, instanceToken: instance, version: result.version, get closed() { return closed }, close: leave })
      }
      ports.port1.onmessage = ({ data }) => {
        if (closed) return
        if (negotiated) {
          void connection?.receive(data).catch(() => close('authorization-failed'))
        } else if (negotiating) {
          close('handshake-invalid')
        } else {
          void negotiate(data).catch(() => close('handshake-invalid'))
        }
      }

      window.addEventListener('message', receiveReady)
      window.addEventListener('pagehide', leave, { once: true })
      workers.addEventListener('controllerchange', controlChanged)
      signal?.addEventListener('abort', leave, { once: true })
      void probe.result.then(available => {
        probe.close()
        if (closed) return
        if (!available || workers.controller !== controller) return close('entry-load-failed')
        this.#mount.append(iframe)
        observer.observe(document, { childList: true, subtree: true })
      }).catch(() => close('entry-load-failed'))
    })
  }
}
