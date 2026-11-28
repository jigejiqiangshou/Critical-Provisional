import type {
  DecisionAnswer, DecisionChoices, MatchOutcome, PendingDecision, RuleContext, RuleResolution, SeatId,
} from './rules'

export interface EffectChoice {
  readonly owner: SeatId
  readonly candidates: DecisionChoices['candidates']
  readonly count: number
  readonly mode: 'condition' | 'result'
  readonly ordered: boolean
  readonly canPass: boolean
  readonly visibility: DecisionChoices['visibility']
}

type Selection = Extract<DecisionAnswer, { kind: 'select' }>

interface EffectUpdate<State, Event> {
  readonly state: State
  readonly events?: readonly Event[]
}

type EffectStep<State, Event> =
  | {
    readonly kind: 'apply'
    readonly apply: (context: RuleContext<State>) => EffectUpdate<State, Event>
    readonly next?: string
  }
  | {
    readonly kind: 'choose'
    readonly choices: (context: Omit<RuleContext<State>, 'random'>) => EffectChoice
    readonly apply: (context: RuleContext<State>, selection: Selection) => EffectUpdate<State, Event>
    readonly next?: string
    readonly unavailable?: string
    readonly empty?: string
    readonly pass?: string
  }
  | {
    readonly kind: 'call'
    readonly program: string
    readonly next?: string
  }
  | {
    readonly kind: 'branch'
    readonly next: (context: RuleContext<State>) => string
  }
  | {
    readonly kind: 'finish'
    readonly outcome: (context: RuleContext<State>) => MatchOutcome
  }

export interface EffectProgram<State, Event> {
  readonly entry: string
  readonly steps: Readonly<Record<string, EffectStep<State, Event>>>
}

interface EffectPosition {
  readonly program: string
  readonly step: string | null
}

/** Persist the rule location and the originating seat across response windows. */
export interface EffectContinuation {
  readonly seat: SeatId
  readonly activeSeat: SeatId
  readonly position: EffectPosition
  readonly stack: readonly EffectPosition[]
}

type DecisionEventBase = {
  readonly type: 'effect-decision'
  readonly owner: SeatId
  readonly choices: DecisionChoices
}

export type EffectDecisionEvent = DecisionEventBase & (
  | { readonly stage: 'offered' }
  | {
    readonly stage: 'resolved'
    readonly resolution: 'automatic' | 'answer' | 'unavailable' | 'empty'
    readonly answer?: DecisionAnswer
  }
)

type EffectResolution<State, Event> = RuleResolution<State, EffectContinuation, Event | EffectDecisionEvent>

type ChoicePlan =
  | { readonly kind: 'unavailable' | 'empty' }
  | { readonly kind: 'wait' }
  | { readonly kind: 'automatic'; readonly answer: Selection }

function planChoice(choice: EffectChoice): { choices: DecisionChoices; plan: ChoicePlan } {
  const { candidates, count, mode, ordered, canPass, visibility } = choice
  if (!Number.isSafeInteger(count) || count <= 0) throw new TypeError('An effect choice requires a positive count')
  const ids = new Set(candidates.map(candidate => candidate.id))
  if (ids.size !== candidates.length || ids.has('')) throw new TypeError('Invalid effect candidate IDs')

  const amount = Math.min(count, candidates.length)
  const choices = { candidates, min: amount, max: amount, ordered, canPass, visibility }
  if (mode === 'condition' && amount < count) return { choices, plan: { kind: 'unavailable' } }
  if (amount === 0) return { choices, plan: { kind: 'empty' } }
  // All candidates are needed for the unique unordered combination. A second
  // candidate in an ordered selection, or the right to pass, adds another decision.
  if (amount < candidates.length || (ordered && amount > 1) || canPass) {
    return { choices, plan: { kind: 'wait' } }
  }
  return { choices, plan: { kind: 'automatic', answer: { kind: 'select', candidateIds: [...ids] } } }
}

function getDefinition<T>(definitions: Readonly<Record<string, T>>, id: string): T {
  if (!Object.hasOwn(definitions, id)) throw new TypeError('Unknown effect program or step: ' + id)
  return definitions[id]
}

export function createEffectRuntime<State, Event>(programs: Readonly<Record<string, EffectProgram<State, Event>>>) {
  function run(
    initial: RuleContext<State>,
    continuation: EffectContinuation,
    response?: { readonly decision: PendingDecision<EffectContinuation>; readonly answer: DecisionAnswer },
  ): EffectResolution<State, Event> {
    let state: State = initial.state
    let position = continuation.position
    const stack = [...continuation.stack]
    const events: (Event | EffectDecisionEvent)[] = []
    const { seat, activeSeat } = continuation
    const context = (): RuleContext<State> => ({ state, snapshot: initial.snapshot, seat, random: initial.random })
    const update = (change: EffectUpdate<State, Event>): void => {
      state = change.state
      if (change.events) events.push(...change.events)
    }
    const advance = (step?: string): void => { position = { program: position.program, step: step ?? null } }

    while (position.step !== null || stack.length > 0) {
      if (position.step === null) {
        position = stack.pop()!
        continue
      }
      const step = getDefinition(getDefinition(programs, position.program).steps, position.step)
      switch (step.kind) {
        case 'apply':
          update(step.apply(context()))
          advance(step.next)
          break
        case 'branch':
          advance(step.next(context()))
          break
        case 'call':
          stack.push({ program: position.program, step: step.next ?? null })
          position = { program: step.program, step: getDefinition(programs, step.program).entry }
          break
        case 'finish':
          return { kind: 'ended', state, events, outcome: step.outcome(context()) }
        case 'choose': {
          if (response) {
            // The core has checked owner, decision ID and selection. Preserve
            // the original candidates and avoid repeating any sampling steps.
            const { decision, answer } = response
            const { owner, choices } = decision
            response = undefined
            if (answer.kind === 'pass') {
              events.push({ type: 'effect-decision', stage: 'resolved', resolution: 'answer', owner, choices, answer })
              advance(step.pass ?? step.next)
              break
            }
            const candidateIds = new Set(answer.candidateIds)
            const selection: Selection = choices.ordered ? answer : {
              kind: 'select', candidateIds: choices.candidates.filter(candidate => candidateIds.has(candidate.id))
                .map(candidate => candidate.id),
            }
            events.push({ type: 'effect-decision', stage: 'resolved', resolution: 'answer', owner, choices, answer: selection })
            update(step.apply(context(), selection))
            advance(step.next)
            break
          }

          const { snapshot } = initial
          const choice = step.choices({ state, snapshot, seat })
          const { choices, plan } = planChoice(choice)
          const { owner } = choice
          if (plan.kind === 'wait') {
            events.push({ type: 'effect-decision', stage: 'offered', owner, choices })
            return {
              kind: 'waiting', state, events,
              decision: { owner, choices, continuation: { seat, activeSeat, position, stack } },
            }
          }
          if (plan.kind === 'automatic') {
            events.push({
              type: 'effect-decision', stage: 'resolved', resolution: 'automatic', owner, choices, answer: plan.answer,
            })
            update(step.apply(context(), plan.answer))
            advance(step.next)
            break
          }
          events.push({ type: 'effect-decision', stage: 'resolved', resolution: plan.kind, owner, choices })
          advance(plan.kind === 'empty' ? step.empty : step.unavailable)
          break
        }
      }
    }
    return { kind: 'active', activeSeat, state, events }
  }

  return {
    start(context: RuleContext<State>, program: string, activeSeat = context.seat): EffectResolution<State, Event> {
      const position = { program, step: getDefinition(programs, program).entry }
      return run(context, { seat: context.seat, activeSeat, position, stack: [] })
    },
    resume(context: RuleContext<State> & {
      readonly decision: PendingDecision<EffectContinuation>
      readonly answer: DecisionAnswer
    }): EffectResolution<State, Event> {
      const { decision, answer } = context
      const { position } = decision.continuation
      if (position.step === null || getDefinition(getDefinition(programs, position.program).steps, position.step).kind !== 'choose') {
        throw new TypeError('Effect continuation must point to a choice')
      }
      return run(context, decision.continuation, { decision, answer })
    },
  }
}
