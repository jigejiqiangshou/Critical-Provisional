import type { Match } from './core'
import {
  negotiatePlayerProtocol, parsePlayerMessage, parseProtocolRange, PLAYER_PROTOCOL_V1,
} from './player-protocol'
import type {
  CommandReceipt, CommandReceiptKey, CommandRequest, CommandRequestSummary, JsonValue, PlayerAction,
  PlayerEvent, ProtocolRange, ProtocolVersion, QueryRequest, SeatId, ServerMessage, SessionId, ViewBasis, ViewScope,
} from './player-protocol'
import type { MatchOutcome } from './rules'

type Awaitable<T> = T | Promise<T>

const boundMessagePorts = new WeakSet<MessagePort>()
const boundProtocolPorts = new WeakSet<PlayerProtocolPort>()

export interface PlayerProtocolPort {
  send(message: ServerMessage): void
  close(): void
}

export interface ConnectionCapability {
  readonly instanceId: string
  readonly sessionId: SessionId
  readonly scope: ViewScope
  readonly version: ProtocolVersion
}

export interface FrontendConnection {
  readonly capability: ConnectionCapability | undefined
  receive(message: unknown): Promise<void>
  close(): void
}

export interface ConfirmedMatch<State> {
  readonly revision: number
  readonly versionHash: string
  readonly state: State
  readonly terminal?: boolean
  readonly outcome?: MatchOutcome
}

/** Wrap the complete core snapshot for confirmation through the player interface. */
export function toConfirmedMatch<State, Continuation>(
  match: Match<State, Continuation>,
): ConfirmedMatch<Match<State, Continuation>> {
  const { revision, versionHash, progress } = match
  return {
    revision,
    versionHash,
    state: match,
    ...(progress.kind === 'ended' ? { terminal: true, outcome: progress.outcome } : {}),
  }
}

export interface RoutedPlayerEvent {
  readonly visibility: { readonly type: 'public' } | { readonly type: 'seat'; readonly seatId: SeatId }
  readonly event: PlayerEvent
}

export interface AdjudicationInput<State> {
  readonly current: ConfirmedMatch<State>
  readonly seatId: SeatId
  readonly expectedRevision: number
  readonly action: PlayerAction
}

export interface AcceptedAdjudication<State, History = unknown> {
  readonly status: 'accepted'
  readonly next: ConfirmedMatch<State>
  // Visible to the command's authorization scope. Persisted as the original result.
  readonly result: JsonValue
  readonly events: readonly RoutedPlayerEvent[]
  readonly history?: History
}

export type CoreAdjudication<State, History = unknown> =
  | AcceptedAdjudication<State, History>
  | { readonly status: 'rejected'; readonly reason: string }

export interface PlayerCore<State, History = unknown> {
  // Return the public or authorized-seat projection, with no internal revision or state.
  project(current: ConfirmedMatch<State>, scope: ViewScope): JsonValue
  // Propose against current without mutation. Expired decisions take priority over stale revisions.
  adjudicate(input: AdjudicationInput<State>): Awaitable<CoreAdjudication<State, History>>
  // Advance a stateful core only after durable confirmation.
  confirm?(accepted: AcceptedAdjudication<State, History>): void
}

export interface CommandConfirmation<State, History = unknown> {
  readonly previous: ConfirmedMatch<State>
  readonly next: ConfirmedMatch<State>
  readonly action: PlayerAction
  readonly receipt: CommandReceipt
  readonly history?: History
}

export interface PlayerCommandStore<State, History = unknown> {
  lookup(key: CommandReceiptKey): Awaitable<CommandRequestSummary | CommandReceipt | undefined>
  recordRejection(summary: CommandRequestSummary): Awaitable<void>
  // Confirm the snapshot, history and receipt atomically, or reject without changing confirmed state.
  confirm(confirmation: CommandConfirmation<State, History>): Awaitable<void>
}

export interface PlayerInterfaceOptions<State, History = unknown> {
  readonly sessionId: SessionId
  readonly confirmed: ConfirmedMatch<State>
  readonly core: PlayerCore<State, History>
  readonly store: PlayerCommandStore<State, History>
  readonly versions?: ProtocolRange
}

interface ProjectedView {
  readonly snapshot: JsonValue
  readonly signature: string
  readonly basis: ViewBasis
}

interface ConnectionState {
  readonly instanceId: string
  readonly port: PlayerProtocolPort
  readonly revisions: Map<ViewBasis, number>
  version?: ProtocolVersion
  capability?: ConnectionCapability
  view?: ProjectedView
  sequence: number
}

function sameScope(left: ViewScope, right: ViewScope): boolean {
  return left.type === 'spectator'
    ? right.type === 'spectator'
    : right.type === 'seat' && left.seatId === right.seatId
}

function snapshotSignature(snapshot: JsonValue): string {
  return JSON.stringify(snapshot, (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : Number(left > right)))
  })
}

async function requestDigest(request: CommandRequest): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([request.basis, request.action]))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export class PlayerInterface<State, History = unknown> {
  readonly #sessionId: SessionId
  readonly #core: PlayerCore<State, History>
  readonly #store: PlayerCommandStore<State, History>
  readonly #versions: ProtocolRange
  readonly #connections = new Map<FrontendConnection, ConnectionState>()

  #confirmed: ConfirmedMatch<State>
  #queue: Promise<void> = Promise.resolve()
  #faulted = false

  constructor(options: PlayerInterfaceOptions<State, History>) {
    const versions = parseProtocolRange(options.versions ?? PLAYER_PROTOCOL_V1)
    if (!versions) throw new TypeError('Invalid host protocol versions')
    this.#sessionId = options.sessionId
    this.#core = options.core
    this.#store = options.store
    this.#versions = versions
    this.#confirmed = options.confirmed
  }

  // The host binds a specific transport to a running frontend instance.
  connect(instanceId: string, port: PlayerProtocolPort): FrontendConnection {
    if (boundProtocolPorts.has(port)) throw new Error('Player protocol port is already bound')
    boundProtocolPorts.add(port)
    const state: ConnectionState = { instanceId, port, revisions: new Map(), sequence: 0 }
    const connection: FrontendConnection = {
      get capability() { return state.capability && structuredClone(state.capability) },
      receive: message => this.#receive(connection, message),
      close: () => this.#close(connection),
    }
    this.#connections.set(connection, state)
    return connection
  }

  connectPort(instanceId: string, port: MessagePort): FrontendConnection {
    if (boundMessagePorts.has(port)) throw new Error('MessagePort is already bound')
    boundMessagePorts.add(port)
    const connection = this.connect(instanceId, {
      send: message => port.postMessage(message),
      close: () => {
        port.removeEventListener('message', receive)
        port.removeEventListener('messageerror', connection.close)
        port.removeEventListener('close', connection.close)
        port.close()
      },
    })
    const receive = (event: MessageEvent<unknown>) => {
      void connection.receive(event.data).catch(connection.close)
    }
    port.addEventListener('message', receive)
    port.addEventListener('messageerror', connection.close)
    port.addEventListener('close', connection.close)
    port.start()
    return connection
  }

  // Only a trusted host supplies a scope after checking the session's seat binding.
  authorize(connection: FrontendConnection, scope: ViewScope): boolean {
    const state = this.#connections.get(connection)
    if (!state?.version || state.capability || this.#confirmed.terminal || this.#faulted) return false
    const capability = {
      instanceId: state.instanceId, sessionId: this.#sessionId, scope: structuredClone(scope), version: state.version,
    }
    const snapshot = this.#core.project(this.#confirmed, capability.scope)
    const view = this.#newView(state, snapshot)
    state.view = view
    state.capability = capability
    return true
  }

  revoke(connection: FrontendConnection): void {
    this.#close(connection)
  }

  // The host can announce a confirmed session's readiness to currently authorized views.
  announceReady(): Promise<void> {
    return this.#enqueue(() => {
      if (this.#confirmed.terminal || this.#faulted) return
      for (const [connection, state] of this.#connections) {
        if (!state.capability || !state.view) continue
        this.#event(connection, state, { type: 'ready', payload: state.view.snapshot })
      }
    })
  }

  #close(connection: FrontendConnection): void {
    const state = this.#connections.get(connection)
    if (!state) return
    this.#connections.delete(connection)
    state.capability = undefined
    state.view = undefined
    state.revisions.clear()
    try {
      state.port.close()
    } catch {
      // Revocation has already removed all access from this connection.
    }
  }

  #send(connection: FrontendConnection, message: ServerMessage): void {
    const state = this.#connections.get(connection)
    if (!state) return
    try {
      state.port.send(structuredClone(message))
    } catch {
      this.#close(connection)
    }
  }

  #enqueue(operation: () => Awaitable<void>): Promise<void> {
    const result = this.#queue.then(operation)
    this.#queue = result.catch(() => {})
    return result
  }

  #receive(connection: FrontendConnection, raw: unknown): Promise<void> {
    const state = this.#connections.get(connection)
    if (!state) return Promise.resolve()
    const message = parsePlayerMessage(raw)
    if (!message) {
      this.#send(connection, { type: 'protocol-error', reason: 'invalid-message' })
      return Promise.resolve()
    }
    if (message.type === 'hello') {
      if (state.version) {
        this.#send(connection, { type: 'protocol-error', reason: 'invalid-message' })
        return Promise.resolve()
      }
      const result = negotiatePlayerProtocol(this.#versions, message.versions)
      if (result.type === 'welcome') state.version = result.version
      this.#send(connection, result)
      if (result.type === 'handshake-rejected') this.#close(connection)
      return Promise.resolve()
    }
    if (!state.version) {
      this.#send(connection, { type: 'protocol-error', reason: 'handshake-required' })
      return Promise.resolve()
    }
    if (message.interaction === 'M03') return this.#enqueue(() => this.#query(connection, message))

    // A private confirmation can advance the revision under an unchanged visible mark.
    // Capture the mark's meaning at submission, before earlier queued commands can advance it.
    const expectedRevision = state.revisions.get(message.basis)
    return this.#enqueue(() => this.#command(connection, message, expectedRevision))
  }

  #query(connection: FrontendConnection, request: QueryRequest): void {
    const state = this.#connections.get(connection)
    if (!state) return
    const { capability, view } = state
    if (!capability || !view || this.#faulted || this.#confirmed.terminal ||
      request.sessionId !== this.#sessionId || (request.scope && !sameScope(request.scope, capability.scope))) {
      this.#send(connection, {
        type: 'response', interaction: 'M03', requestId: request.requestId,
        result: { status: 'rejected', reason: 'unauthorized' },
      })
      return
    }
    this.#send(connection, {
      type: 'response', interaction: 'M03', requestId: request.requestId,
      result: {
        status: 'ok', view: {
          sequence: state.sequence, scope: capability.scope, basis: view.basis, snapshot: view.snapshot,
        },
      },
    })
  }

  #isAuthorized(connection: FrontendConnection, request: CommandRequest): boolean {
    const capability = this.#connections.get(connection)?.capability
    return Boolean(!this.#faulted && !this.#confirmed.terminal && capability &&
      request.sessionId === capability.sessionId && capability.scope.type === 'seat' &&
      request.seatId === capability.scope.seatId)
  }

  #reject(connection: FrontendConnection, request: CommandRequest, reason: string): void {
    this.#send(connection, {
      type: 'response', interaction: 'M02', requestId: request.requestId, result: { status: 'rejected', reason },
    })
  }

  #receipt(connection: FrontendConnection, request: CommandRequest, receipt: CommandReceipt): void {
    this.#send(connection, {
      type: 'response', interaction: 'M02', requestId: request.requestId,
      result: { status: 'accepted', receipt: { commandId: receipt.key.commandId, result: receipt.result } },
    })
  }

  async #command(connection: FrontendConnection, request: CommandRequest, expectedRevision: number | undefined): Promise<void> {
    if (!this.#isAuthorized(connection, request)) return this.#reject(connection, request, 'unauthorized')
    const key = { sessionId: this.#sessionId, seatId: request.seatId, commandId: request.commandId }
    const previous = this.#confirmed
    const digest = await requestDigest(request)
    if (!this.#isAuthorized(connection, request)) return
    let registered: CommandRequestSummary | CommandReceipt | undefined
    try {
      registered = await this.#store.lookup(key)
    } catch {
      return this.#reject(connection, request, 'storage-failed')
    }
    if (!this.#isAuthorized(connection, request)) return

    if (registered) {
      if (registered.versionHash !== previous.versionHash) return this.#reject(connection, request, 'storage-failed')
      if (registered.requestDigest !== digest) return this.#reject(connection, request, 'command-id-conflict')
      if ('result' in registered) return this.#receipt(connection, request, registered)
      expectedRevision = registered.expectedRevision
    }
    if (expectedRevision === undefined) return this.#reject(connection, request, 'invalid-basis')

    const summary = { key, versionHash: previous.versionHash, requestDigest: digest, expectedRevision }
    const adjudication = await this.#core.adjudicate({
      current: previous, seatId: key.seatId, expectedRevision, action: request.action,
    })
    if (!this.#isAuthorized(connection, request)) return
    if (adjudication.status === 'rejected' || expectedRevision !== previous.revision) {
      if (!registered) {
        try {
          await this.#store.recordRejection(summary)
        } catch {
          return this.#reject(connection, request, 'storage-failed')
        }
      }
      const reason = adjudication.status === 'rejected' ? adjudication.reason : 'stale-basis'
      return this.#reject(connection, request, reason)
    }

    const { next, history } = adjudication
    if (next.revision !== previous.revision + 1 || next.versionHash !== previous.versionHash) {
      throw new Error('Core proposed an invalid confirmation')
    }
    const receipt = { ...summary, result: structuredClone(adjudication.result) }
    try {
      await this.#store.confirm({ previous, next, action: request.action, receipt, history })
    } catch {
      return this.#reject(connection, request, 'storage-failed')
    }
    this.#confirmed = next
    // An authorization issued during delivery starts at the new snapshot.
    const recipients = [...this.#connections].filter(([, state]) => state.capability)
    try {
      this.#core.confirm?.(adjudication)
    } catch {
      this.#faulted = true
    }
    this.#receipt(connection, request, receipt)
    this.#publish(recipients, adjudication.events, connection, request.commandId)
    if (next.terminal || this.#faulted) {
      for (const active of this.#connections.keys()) this.#close(active)
    }
  }

  #newView(state: ConnectionState, snapshot: JsonValue): ProjectedView {
    const basis = crypto.randomUUID()
    state.revisions.set(basis, this.#confirmed.revision)
    return { snapshot: structuredClone(snapshot), signature: snapshotSignature(snapshot), basis }
  }

  #event(connection: FrontendConnection, state: ConnectionState, event: PlayerEvent, commandId?: string): void {
    if (!state.view || !this.#connections.has(connection)) return
    state.sequence++
    this.#send(connection, {
      type: 'event', interaction: 'M04', sessionId: this.#sessionId, sequence: state.sequence,
      basis: state.view.basis, event, ...(commandId === undefined ? {} : { commandId }),
    })
  }

  #publish(
    recipients: readonly [FrontendConnection, ConnectionState][],
    events: readonly RoutedPlayerEvent[],
    origin: FrontendConnection,
    commandId: string,
  ): void {
    for (const [connection, state] of recipients) {
      const { capability, view } = state
      if (!capability || !view || !this.#connections.has(connection)) continue
      const { scope } = capability
      const visible = events.filter(({ visibility, event }) => event.type !== 'terminal' &&
        (visibility.type === 'public' || sameScope(scope, visibility))).map(({ event }) => event)
      let snapshot: JsonValue
      try {
        snapshot = this.#core.project(this.#confirmed, scope)
      } catch {
        this.#close(connection)
        continue
      }
      const changed = snapshotSignature(snapshot) !== view.signature
      if (this.#confirmed.terminal) visible.push({ type: 'terminal', payload: snapshot })
      if (!visible.length && changed) visible.push({ type: 'action', payload: snapshot })
      if (!visible.length) {
        state.revisions.set(view.basis, this.#confirmed.revision)
        continue
      }
      state.view = this.#newView(state, snapshot)
      for (const event of visible) this.#event(connection, state, event, connection === origin ? commandId : undefined)
    }
  }
}
