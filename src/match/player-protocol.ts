export type SessionId = string
export type SeatId = string
export type CommandId = string
export type DecisionId = string
export type ViewBasis = string

export type JsonValue =
  | null | boolean | number | string
  | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export interface ProtocolRange {
  readonly major: number
  readonly minMinor: number
  readonly maxMinor: number
}

export interface ProtocolVersion {
  readonly major: number
  readonly minor: number
}

export const PLAYER_PROTOCOL_V1: ProtocolRange = Object.freeze({ major: 1, minMinor: 0, maxMinor: 0 })

export type VersionNegotiation =
  | { readonly type: 'welcome'; readonly version: ProtocolVersion }
  | {
    readonly type: 'handshake-rejected'
    readonly reason: 'major-version-mismatch' | 'no-common-minor-version'
    readonly host: ProtocolRange
    readonly client: ProtocolRange
  }

export function negotiatePlayerProtocol(host: ProtocolRange, client: ProtocolRange): VersionNegotiation {
  if (host.major !== client.major) {
    return { type: 'handshake-rejected', reason: 'major-version-mismatch', host, client }
  }
  const minor = Math.min(host.maxMinor, client.maxMinor)
  if (minor < Math.max(host.minMinor, client.minMinor)) {
    return { type: 'handshake-rejected', reason: 'no-common-minor-version', host, client }
  }
  return { type: 'welcome', version: { major: host.major, minor } }
}

export type ViewScope =
  | { readonly type: 'seat'; readonly seatId: SeatId }
  | { readonly type: 'spectator' }

export interface View {
  readonly sequence: number
  readonly scope: ViewScope
  readonly basis: ViewBasis
  readonly snapshot: JsonValue
}

export type DecisionChoice =
  | { readonly type: 'select'; readonly targetIds: readonly string[] }
  | { readonly type: 'pass' }

export type PlayerAction =
  | { readonly type: 'mulligan'; readonly cardIds: readonly string[] }
  | { readonly type: 'play-card' | 'evolve'; readonly cardId: string; readonly targets?: readonly string[] }
  | { readonly type: 'attack'; readonly attackerId: string; readonly targetId: string }
  | {
    readonly type: 'activate-skill'
    readonly sourceId: string
    readonly skillId: string
    readonly targets?: readonly string[]
  }
  | { readonly type: 'end-turn' | 'concede' }
  | { readonly type: 'respond'; readonly decisionId: DecisionId; readonly choice: DecisionChoice }

interface PlayerRequest {
  readonly type: 'request'
  readonly requestId: string
  readonly sessionId: SessionId
}

export interface CommandRequest extends PlayerRequest {
  readonly interaction: 'M02'
  readonly seatId: SeatId
  readonly commandId: CommandId
  readonly basis: ViewBasis
  readonly action: PlayerAction
}

export interface QueryRequest extends PlayerRequest {
  readonly interaction: 'M03'
  readonly scope?: ViewScope
}

export type ClientMessage =
  | { readonly type: 'hello'; readonly versions: ProtocolRange }
  | CommandRequest | QueryRequest

export interface CommandReceiptKey {
  readonly sessionId: SessionId
  readonly seatId: SeatId
  readonly commandId: CommandId
}

export interface CommandRequestSummary {
  readonly key: CommandReceiptKey
  readonly versionHash: string
  readonly requestDigest: string
  // Retained server-side so the same registered request can be interpreted after reconnect.
  readonly expectedRevision: number
}

export interface CommandReceipt extends CommandRequestSummary {
  readonly result: JsonValue
}

export type RequestRejection = { readonly status: 'rejected'; readonly reason: string }

export type CommandResult =
  | { readonly status: 'accepted'; readonly receipt: { readonly commandId: CommandId; readonly result: JsonValue } }
  | RequestRejection

export type QueryResult = { readonly status: 'ok'; readonly view: View } | RequestRejection

export type PlayerEvent = {
  readonly type: 'ready' | 'action' | 'decision' | 'terminal'
  readonly payload: JsonValue
}

export interface EventMessage {
  readonly type: 'event'
  readonly interaction: 'M04'
  readonly sessionId: SessionId
  readonly sequence: number
  readonly basis: ViewBasis
  readonly event: PlayerEvent
  readonly commandId?: CommandId
}

export type ServerMessage =
  | VersionNegotiation
  | { readonly type: 'protocol-error'; readonly reason: 'invalid-message' | 'handshake-required' }
  | { readonly type: 'response'; readonly interaction: 'M02'; readonly requestId: string; readonly result: CommandResult }
  | { readonly type: 'response'; readonly interaction: 'M03'; readonly requestId: string; readonly result: QueryResult }
  | EventMessage

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function id(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function ids(value: unknown): value is readonly string[] {
  return Array.isArray(value) && Array.from(value).every(id)
}

function natural(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function parseProtocolRange(value: unknown): ProtocolRange | undefined {
  if (!record(value)) return
  const { major, minMinor, maxMinor } = value
  if (natural(major) && natural(minMinor) && natural(maxMinor) && minMinor <= maxMinor) {
    return { major, minMinor, maxMinor }
  }
}

function parseScope(value: unknown): ViewScope | undefined {
  if (!record(value)) return
  if (value.type === 'spectator') return { type: 'spectator' }
  if (value.type === 'seat' && id(value.seatId)) return { type: 'seat', seatId: value.seatId }
}

function parseChoice(value: unknown): DecisionChoice | undefined {
  if (!record(value)) return
  if (value.type === 'pass') return { type: 'pass' }
  if (value.type === 'select' && ids(value.targetIds)) return { type: 'select', targetIds: [...value.targetIds] }
}

export function parsePlayerAction(value: unknown): PlayerAction | undefined {
  if (!record(value)) return
  const { type, cardIds, cardId, attackerId, targetId, sourceId, skillId, targets, decisionId } = value
  switch (type) {
    case 'mulligan':
      if (ids(cardIds)) return { type, cardIds: [...cardIds] }
      break
    case 'play-card':
    case 'evolve':
      if (id(cardId) && (targets === undefined || ids(targets))) {
        return targets === undefined ? { type, cardId } : { type, cardId, targets: [...targets] }
      }
      break
    case 'attack':
      if (id(attackerId) && id(targetId)) return { type, attackerId, targetId }
      break
    case 'activate-skill':
      if (id(sourceId) && id(skillId) && (targets === undefined || ids(targets))) {
        return targets === undefined ? { type, sourceId, skillId } : { type, sourceId, skillId, targets: [...targets] }
      }
      break
    case 'respond': {
      const choice = parseChoice(value.choice)
      if (id(decisionId) && choice) return { type, decisionId, choice }
      break
    }
    case 'end-turn':
    case 'concede':
      return { type }
  }
}

export function parsePlayerMessage(value: unknown): ClientMessage | undefined {
  if (!record(value)) return
  if (value.type === 'hello') {
    const versions = parseProtocolRange(value.versions)
    if (versions) return { type: 'hello', versions }
    return
  }
  const { type, interaction, requestId, sessionId } = value
  if (type !== 'request' || !id(requestId) || !id(sessionId)) return
  if (interaction === 'M03') {
    const scope = parseScope(value.scope)
    if (scope) return { type, interaction, requestId, sessionId, scope }
    if (value.scope === undefined) return { type, interaction, requestId, sessionId }
  }
  if (interaction === 'M02') {
    const { seatId, commandId, basis } = value
    const action = parsePlayerAction(value.action)
    if (id(seatId) && id(commandId) && id(basis) && action) {
      return { type, interaction, requestId, sessionId, seatId, commandId, basis, action }
    }
  }
}
