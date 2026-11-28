import type {
  CardPoolSnapshot,
  DecisionAnswer,
  DecisionChoices,
  MatchOutcome,
  PendingDecision,
  RuleResolution,
  Ruleset,
  SeatId,
} from './rules'

/** Both the generator state and the position in a fixed input tape can survive a restart. */
export type RandomState =
  | { readonly kind: 'seeded'; readonly state: number; readonly consumed: number }
  | { readonly kind: 'recorded'; readonly inputs: readonly number[]; readonly consumed: number }

export type MatchProgress<Continuation> =
  | { readonly kind: 'active'; readonly activeSeat: SeatId }
  | { readonly kind: 'waiting'; readonly decision: PendingDecision<Continuation> }
  | { readonly kind: 'ended'; readonly outcome: MatchOutcome }

export interface Match<State, Continuation> {
  readonly revision: number
  readonly snapshotRef: string
  readonly rulesVersion: string
  readonly versionHash: string
  readonly state: Readonly<State>
  readonly progress: MatchProgress<Continuation>
  readonly random: RandomState
  readonly nextDecisionId: number
}

export type CoreCommand<Action> =
  | { readonly kind: 'action'; readonly seat: SeatId; readonly expectedRevision: number; readonly action: Action }
  | {
    readonly kind: 'decision'
    readonly seat: SeatId
    readonly expectedRevision: number
    readonly decisionId: string
    readonly answer: DecisionAnswer
  }

export interface MatchCandidate<State, Continuation, Event> {
  readonly kind: 'accepted'
  readonly previousRevision: number
  readonly match: Match<State, Continuation>
  /** Confirmed callers may record this exact order with the matching action. */
  readonly events: readonly Event[]
  /** Trusted history only. The order matches calls to the rule's random input. */
  readonly randomInputs: readonly number[]
}

export type MatchProposal<State, Continuation, Event> =
  | { readonly kind: 'rejected'; readonly reason: string }
  | MatchCandidate<State, Continuation, Event>

export type MatchRecoveryReason = 'version-unavailable' | 'version-hash-mismatch' | 'incomplete-record'

export class MatchRecoveryError extends Error {
  readonly reason: MatchRecoveryReason

  constructor(reason: MatchRecoveryReason) {
    super(reason)
    this.name = 'MatchRecoveryError'
    this.reason = reason
  }
}

class RandomInputExhaustedError extends Error {}

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function stableJson(value: unknown, parents = new Set<object>()): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))) {
    return JSON.stringify(value)
  }
  if (!Array.isArray(value) && !record(value)) throw new TypeError('Match data must be JSON-serializable')
  if (parents.has(value)) throw new TypeError('Match data cannot contain cycles')

  parents.add(value)
  const encoded = Array.isArray(value)
    ? '[' + Array.from(value, item => stableJson(item, parents)).join(',') + ']'
    : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key], parents)).join(',') + '}'
  parents.delete(value)
  return encoded
}

function freezeJson(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  for (const item of Object.values(value)) freezeJson(item)
  Object.freeze(value)
}

function copyJson<T>(value: T): T {
  const copy: T = JSON.parse(stableJson(value))
  freezeJson(copy)
  return copy
}

export async function computeVersionHash(
  rules: Pick<Ruleset<unknown, unknown, unknown, unknown>, 'version' | 'artifact'>,
  snapshot: CardPoolSnapshot,
): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson({
    format: 'critical-match-version-v1',
    rules: { version: rules.version, artifact: rules.artifact },
    snapshot: { id: snapshot.id, rulesVersion: snapshot.rulesVersion, content: snapshot.content },
  }))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function natural(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function randomValue(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value < 1
}

function validRandom(value: unknown): value is RandomState {
  if (!record(value) || !natural(value.consumed)) return false
  if (value.kind === 'seeded') return natural(value.state) && value.state <= 0xffffffff
  return value.kind === 'recorded' && Array.isArray(value.inputs) &&
    value.inputs.every(randomValue) && value.consumed <= value.inputs.length
}

function randomInput(initial: RandomState) {
  let state = initial.kind === 'seeded' ? initial.state : 0
  let consumed = initial.consumed
  const inputs: number[] = []

  function next() {
    let value: number
    if (initial.kind === 'recorded') {
      if (consumed === initial.inputs.length) throw new RandomInputExhaustedError()
      value = initial.inputs[consumed]
    } else {
      // Mulberry32: the persisted state advances once per draw.
      state = (state + 0x6d2b79f5) >>> 0
      let mixed = Math.imul(state ^ (state >>> 15), state | 1)
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
      value = ((mixed ^ (mixed >>> 14)) >>> 0) / 0x100000000
    }
    consumed++
    inputs.push(value)
    return value
  }

  return {
    next,
    inputs,
    state(): RandomState {
      return initial.kind === 'seeded' ? { kind: 'seeded', state, consumed } : { ...initial, consumed }
    },
  }
}

function validChoices(choices: unknown): choices is DecisionChoices {
  if (!record(choices) || !Array.isArray(choices.candidates) ||
    !natural(choices.min) || !natural(choices.max) ||
    choices.min > choices.max || choices.max > choices.candidates.length ||
    typeof choices.ordered !== 'boolean' || typeof choices.canPass !== 'boolean' ||
    (choices.visibility !== 'public' && choices.visibility !== 'owner')) return false

  const ids = new Set<string>()
  for (const candidate of choices.candidates) {
    if (!record(candidate) || !validId(candidate.id) || ids.has(candidate.id)) return false
    ids.add(candidate.id)
  }
  return true
}

function legalAnswer(choices: DecisionChoices, answer: unknown): boolean {
  if (!record(answer)) return false
  if (answer.kind === 'pass') return choices.canPass
  if (answer.kind !== 'select' || !Array.isArray(answer.candidateIds)) return false
  const { candidateIds } = answer
  if (candidateIds.length < choices.min || candidateIds.length > choices.max) return false
  const allowed = new Set(choices.candidates.map(candidate => candidate.id))
  for (const id of candidateIds) {
    if (!validId(id) || !allowed.delete(id)) return false
  }
  return true
}

function validProgress(value: unknown, nextDecisionId: number): boolean {
  if (!record(value)) return false
  if (value.kind === 'active') return validId(value.activeSeat)
  if (value.kind === 'ended') {
    return record(value.outcome) && validId(value.outcome.reason) &&
      (validId(value.outcome.winner) || value.outcome.winner === null)
  }
  return value.kind === 'waiting' && record(value.decision) && nextDecisionId > 1 &&
    value.decision.id === 'decision-' + (nextDecisionId - 1) && validId(value.decision.owner) &&
    Object.hasOwn(value.decision, 'continuation') && validChoices(value.decision.choices)
}

function lockedResources<State, Action, Continuation, Event>(
  rules: Ruleset<State, Action, Continuation, Event>,
  snapshot: CardPoolSnapshot,
) {
  return {
    rules: Object.freeze({
      version: rules.version,
      artifact: copyJson(rules.artifact),
      resolveAction: rules.resolveAction,
      resumeDecision: rules.resumeDecision,
    }),
    snapshot: copyJson(snapshot),
  }
}

/** The trusted host persists a candidate before confirming it. Until then read()
 * and future proposals use only the last confirmed match.
 */
export class MatchCore<State, Action, Continuation, Event> {
  readonly #rules: Ruleset<State, Action, Continuation, Event>
  readonly #snapshot: CardPoolSnapshot
  #current: Match<State, Continuation>
  readonly #candidates = new WeakMap<MatchCandidate<State, Continuation, Event>, Match<State, Continuation>>()

  private constructor(
    rules: Ruleset<State, Action, Continuation, Event>,
    snapshot: CardPoolSnapshot,
    match: Match<State, Continuation>,
  ) {
    this.#rules = rules
    this.#snapshot = snapshot
    this.#current = match
  }

  static async create<State, Action, Continuation, Event>(setup: {
    readonly rules: Ruleset<State, Action, Continuation, Event>
    readonly snapshot: CardPoolSnapshot
    readonly state: State
    readonly activeSeat: SeatId
    readonly random: RandomState
  }): Promise<MatchCore<State, Action, Continuation, Event>> {
    const { rules, snapshot } = lockedResources(setup.rules, setup.snapshot)
    if (!validId(rules.version) || !validId(snapshot.id) || snapshot.rulesVersion !== rules.version) {
      throw new TypeError('Match requires matching rule and card pool versions')
    }
    if (!validId(setup.activeSeat) || !validRandom(setup.random) || setup.random.consumed !== 0) {
      throw new TypeError('Match requires an initial seat and unused random input')
    }
    const initial = copyJson({ state: setup.state, activeSeat: setup.activeSeat, random: setup.random })
    const versionHash = await computeVersionHash(rules, snapshot)
    const match: Match<State, Continuation> = Object.freeze({
      revision: 0,
      snapshotRef: snapshot.id,
      rulesVersion: rules.version,
      versionHash,
      state: initial.state,
      progress: Object.freeze({ kind: 'active', activeSeat: initial.activeSeat }),
      random: initial.random,
      nextDecisionId: 1,
    })
    return new MatchCore(rules, snapshot, match)
  }

  static async restore<State, Action, Continuation, Event>(setup: {
    readonly rules?: Ruleset<State, Action, Continuation, Event>
    readonly snapshot?: CardPoolSnapshot
    readonly match: unknown
  }): Promise<MatchCore<State, Action, Continuation, Event>> {
    let match: unknown
    try {
      match = copyJson(setup.match)
    } catch {
      throw new MatchRecoveryError('incomplete-record')
    }
    if (!record(match) || !validId(match.snapshotRef) || !validId(match.rulesVersion) ||
      typeof match.versionHash !== 'string' || !/^[a-f0-9]{64}$/.test(match.versionHash) ||
      !natural(match.revision) || !natural(match.nextDecisionId) || match.nextDecisionId < 1 ||
      match.nextDecisionId > match.revision + 1 ||
      !Object.hasOwn(match, 'state') || !validRandom(match.random) || !validProgress(match.progress, match.nextDecisionId)) {
      throw new MatchRecoveryError('incomplete-record')
    }
    if (!setup.rules || !setup.snapshot || setup.rules.version !== match.rulesVersion ||
      setup.snapshot.id !== match.snapshotRef || setup.snapshot.rulesVersion !== match.rulesVersion) {
      throw new MatchRecoveryError('version-unavailable')
    }
    const { rules, snapshot } = lockedResources(setup.rules, setup.snapshot)
    if (await computeVersionHash(rules, snapshot) !== match.versionHash) {
      throw new MatchRecoveryError('version-hash-mismatch')
    }
    return new MatchCore(rules, snapshot, match as unknown as Match<State, Continuation>)
  }

  read(): Match<State, Continuation> {
    return this.#current
  }

  propose(command: CoreCommand<Action>): MatchProposal<State, Continuation, Event> {
    const current = this.#current
    const progress = current.progress
    if (progress.kind === 'ended') return { kind: 'rejected', reason: 'match-ended' }
    if (command.kind === 'decision' && (progress.kind !== 'waiting' || command.decisionId !== progress.decision.id)) {
      return { kind: 'rejected', reason: 'decision-expired' }
    }
    if (command.expectedRevision !== current.revision) return { kind: 'rejected', reason: 'stale-revision' }

    const random = randomInput(current.random)
    const context = { state: current.state, snapshot: this.#snapshot, random: random.next, seat: command.seat }
    let resolution: RuleResolution<State, Continuation, Event>
    try {
      if (command.kind === 'action') {
        if (progress.kind === 'waiting') return { kind: 'rejected', reason: 'decision-pending' }
        if (command.seat !== progress.activeSeat) return { kind: 'rejected', reason: 'wrong-seat' }
        resolution = this.#rules.resolveAction({ ...context, action: command.action })
      } else {
        if (progress.kind !== 'waiting' || command.seat !== progress.decision.owner) {
          return { kind: 'rejected', reason: 'wrong-seat' }
        }
        if (!legalAnswer(progress.decision.choices, command.answer)) {
          return { kind: 'rejected', reason: 'illegal-choice' }
        }
        resolution = this.#rules.resumeDecision({ ...context, decision: progress.decision, answer: command.answer })
      }
    } catch (error) {
      if (error instanceof RandomInputExhaustedError) return { kind: 'rejected', reason: 'random-input-exhausted' }
      throw error
    }
    if (resolution.kind === 'rejected') return { kind: 'rejected', reason: resolution.reason }

    let nextProgress: MatchProgress<Continuation>
    let nextDecisionId = current.nextDecisionId
    switch (resolution.kind) {
      case 'active':
        nextProgress = { kind: 'active', activeSeat: resolution.activeSeat }
        break
      case 'waiting':
        nextProgress = {
          kind: 'waiting',
          decision: { ...resolution.decision, id: 'decision-' + nextDecisionId },
        }
        nextDecisionId++
        break
      case 'ended':
        nextProgress = { kind: 'ended', outcome: resolution.outcome }
        break
    }
    const nextRandom = random.state()
    if (!validProgress(nextProgress, nextDecisionId) ||
      !natural(nextDecisionId) || !natural(current.revision + 1) || !validRandom(nextRandom)) {
      throw new TypeError('Rules returned invalid settlement progress')
    }
    if (nextRandom.consumed === current.random.consumed &&
      stableJson([resolution.state, nextProgress]) === stableJson([current.state, current.progress])) {
      return { kind: 'rejected', reason: 'no-state-change' }
    }

    const candidate: MatchCandidate<State, Continuation, Event> = copyJson({
      kind: 'accepted',
      previousRevision: current.revision,
      match: {
        ...current,
        revision: current.revision + 1,
        state: resolution.state,
        progress: nextProgress,
        random: nextRandom,
        nextDecisionId,
      },
      events: resolution.events,
      randomInputs: random.inputs,
    })
    this.#candidates.set(candidate, current)
    return candidate
  }

  confirm(candidate: MatchCandidate<State, Continuation, Event>): void {
    if (this.#candidates.get(candidate) !== this.#current) {
      throw new TypeError('Candidate was not proposed against the current match')
    }
    this.#current = candidate.match
  }
}
