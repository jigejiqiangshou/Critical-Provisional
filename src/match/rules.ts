/** The persisted rule and settlement data use only JSON values. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

export type SeatId = string

export interface CardPoolSnapshot {
  readonly id: string
  readonly rulesVersion: string
  readonly content: JsonValue
}

export interface DecisionChoices {
  readonly candidates: readonly { readonly id: string; readonly payload?: JsonValue }[]
  readonly min: number
  readonly max: number
  readonly ordered: boolean
  readonly canPass: boolean
  readonly visibility: 'public' | 'owner'
}

export type DecisionAnswer =
  | { readonly kind: 'select'; readonly candidateIds: readonly string[] }
  | { readonly kind: 'pass' }

export interface PendingDecision<Continuation> {
  readonly id: string
  readonly owner: SeatId
  readonly choices: DecisionChoices
  readonly continuation: Continuation
}

export interface MatchOutcome {
  readonly winner: SeatId | null
  readonly reason: string
}

type SuccessfulRuleResolution<State, Event> = {
  readonly state: State
  readonly events: readonly Event[]
}

export type RuleResolution<State, Continuation, Event> =
  | { readonly kind: 'rejected'; readonly reason: string }
  | (SuccessfulRuleResolution<State, Event> & {
    readonly kind: 'active'
    readonly activeSeat: SeatId
  })
  | (SuccessfulRuleResolution<State, Event> & {
    readonly kind: 'waiting'
    readonly decision: Omit<PendingDecision<Continuation>, 'id'>
  })
  | (SuccessfulRuleResolution<State, Event> & {
    readonly kind: 'ended'
    readonly outcome: MatchOutcome
  })

interface RuleContext<State> {
  readonly state: Readonly<State>
  readonly snapshot: CardPoolSnapshot
  readonly seat: SeatId
  /** Draw the next value in [0, 1) from the core-owned stream. */
  readonly random: () => number
}

/** Synchronous, deterministic rules. The versioned artifact describes the actual
 * loaded rules, including a digest of any executable rule components it uses.
 * The outcome, input data and continuation must be JSON-serializable.
 */
export interface Ruleset<State, Action, Continuation, Event> {
  readonly version: string
  readonly artifact: JsonValue
  resolveAction(context: RuleContext<State> & { readonly action: Action }): RuleResolution<State, Continuation, Event>
  resumeDecision(context: RuleContext<State> & {
    readonly decision: PendingDecision<Continuation>
    readonly answer: DecisionAnswer
  }): RuleResolution<State, Continuation, Event>
}
