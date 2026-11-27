import { describe, expect, it } from 'vitest'
import { MatchCore } from '../../src/match/core'
import { createEffectRuntime } from '../../src/match/effects'
import type { EffectContinuation, EffectDecisionEvent } from '../../src/match/effects'
import { PlayerInterface, projectEffectChoices, routeEffectDecisionEvent, toConfirmedMatch } from '../../src/match/player-interface'
import type { PlayerCommandStore, PlayerCore } from '../../src/match/player-interface'
import { PLAYER_PROTOCOL_V1 } from '../../src/match/player-protocol'
import type { CommandReceipt, CommandRequestSummary, JsonValue, PlayerAction, ServerMessage, ViewScope } from '../../src/match/player-protocol'
import type { DecisionAnswer, Ruleset } from '../../src/match/rules'

type State = { readonly trace: readonly string[] }
type Event = { readonly type: 'fixture'; readonly value: string }
type Selection = {
  readonly mode: 'condition' | 'result'
  readonly ids: readonly string[]
  readonly count: number
  readonly canPass?: boolean
  readonly ordered?: boolean
  readonly visibility?: 'owner' | 'public'
}

const sessionId = 'independent-effect-fixture'
const version = 'fixture-effect-rules-v1'
const snapshot = { id: 'fixture-card-pool', rulesVersion: version, content: [] }

function record(state: State, value: string) {
  return { state: { trace: [...state.trace, value] }, events: [{ type: 'fixture', value }] as const }
}

function fixture(selection: Selection) {
  // The nesting represents an attack suspended by a responder-owned window. The same
  // named branches also model a condition cost and a clamped result such as LG-08.
  const runtime = createEffectRuntime<State, Event>({
    attack: {
      entry: 'before',
      steps: {
        before: { kind: 'apply', apply: ({ state, random }) => record(state, `before:${random()}`), next: 'call' },
        call: { kind: 'call', program: 'window', next: 'after' },
        after: { kind: 'apply', apply: ({ state, random }) => record(state, `after:${random()}`) },
      },
    },
    window: {
      entry: 'choose',
      steps: {
        choose: {
          kind: 'choose',
          choices: () => ({
            owner: 'defender', candidates: selection.ids.map(id => ({ id })),
            count: selection.count, mode: selection.mode, ordered: selection.ordered ?? false,
            canPass: selection.canPass ?? false, visibility: selection.visibility ?? 'public',
          }),
          apply: ({ state }, answer) => record(state, answer.kind === 'select' ? answer.candidateIds.join(',') : 'pass'),
          next: 'resolved', pass: 'declined', unavailable: 'insufficient', empty: 'empty',
        },
        resolved: { kind: 'apply', apply: ({ state }) => record(state, 'resolved') },
        declined: { kind: 'apply', apply: ({ state }) => record(state, 'declined') },
        insufficient: { kind: 'apply', apply: ({ state }) => record(state, 'insufficient') },
        empty: { kind: 'apply', apply: ({ state }) => record(state, 'empty') },
      },
    },
  })
  const rules: Ruleset<State, PlayerAction, EffectContinuation, Event | EffectDecisionEvent> = {
    version,
    artifact: ['independent fixture', selection.ids, selection.mode, selection.count,
      selection.canPass ?? false, selection.ordered ?? false, selection.visibility ?? 'public'],
    resolveAction(context) {
      return runtime.start(context, 'attack')
    },
    resumeDecision(context) {
      return runtime.resume(context)
    },
  }
  return {
    rules,
    create: () => MatchCore.create({
      rules, snapshot, state: { trace: [] }, activeSeat: 'attacker',
      random: { kind: 'recorded', inputs: [0.25, 0.75], consumed: 0 },
    }),
  }
}

type Core = Awaited<ReturnType<ReturnType<typeof fixture>['create']>>
type CoreSnapshot = ReturnType<Core['read']>
type Proposal = ReturnType<Core['propose']>
type Accepted = Extract<Proposal, { kind: 'accepted' }>
type History = { readonly events: Accepted['events']; readonly randomInputs: Accepted['randomInputs'] }

function accepted(proposal: Proposal): Accepted {
  expect(proposal).toMatchObject({ kind: 'accepted' })
  if (proposal.kind !== 'accepted') throw new Error(proposal.reason)
  return proposal
}

function trigger(core: Core) {
  return accepted(core.propose({
    kind: 'action', seat: 'attacker', expectedRevision: 0, action: { type: 'attack', attackerId: 'fixture-attacker', targetId: 'fixture-defender' },
  }))
}

function respond(core: Core, answer: DecisionAnswer, seat = 'defender') {
  const current = core.read()
  if (current.progress.kind !== 'waiting') throw new Error('Expected a pending response')
  return core.propose({
    kind: 'decision', expectedRevision: current.revision, seat,
    decisionId: current.progress.decision.id, answer,
  })
}

const select = (...candidateIds: string[]): DecisionAnswer => ({ kind: 'select', candidateIds })

describe('FR-012 effect decisions through the authoritative core', () => {
  it.each([
    { mode: 'condition', ids: ['one', 'two'], count: 3, trace: ['insufficient'] },
    { mode: 'condition', ids: ['one', 'two', 'three'], count: 3, trace: ['one,two,three', 'resolved'] },
    { mode: 'result', ids: [], count: 3, trace: ['empty'] },
    { mode: 'result', ids: ['one'], count: 3, trace: ['one', 'resolved'] },
    { mode: 'result', ids: ['one', 'two'], count: 3, trace: ['one,two', 'resolved'] },
  ] as const)('settles the $mode with candidates $ids within the triggering confirmation', async ({ trace, ...selection }) => {
    const core = await fixture(selection).create()
    const result = trigger(core)
    expect(core.read()).toMatchObject({ revision: 0, state: { trace: [] } })
    core.confirm(result)
    expect(core.read()).toMatchObject({
      revision: 1, progress: { kind: 'active', activeSeat: 'attacker' },
      state: { trace: ['before:0.25', ...trace, 'after:0.75'] },
    })
    expect(result.randomInputs).toEqual([0.25, 0.75])
  })

  it.each([
    { answer: select('zhenyue'), result: ['zhenyue', 'resolved'] },
    { answer: { kind: 'pass' } as const, result: ['declined'] },
  ])('suspends for the optional single LG-06 response and resumes $answer.kind', async ({ answer, result }) => {
    const { rules, create } = fixture({ mode: 'result', ids: ['zhenyue'], count: 1, canPass: true })
    const core = await create()
    const offered = trigger(core)
    core.confirm(offered)
    expect(offered.randomInputs).toEqual([0.25])
    expect(core.read()).toMatchObject({
      revision: 1, state: { trace: ['before:0.25'] }, progress: {
        kind: 'waiting', decision: { owner: 'defender', choices: { canPass: true, min: 1, max: 1 } },
      },
    })
    const restored = await MatchCore.restore({
      rules, snapshot, match: JSON.parse(JSON.stringify(core.read())),
    })
    expect(restored.read()).toEqual(core.read())
    expect(respond(restored, answer, 'attacker')).toMatchObject({ kind: 'rejected' })
    expect(respond(restored, select('unknown'))).toMatchObject({ kind: 'rejected' })
    expect(restored.read()).toEqual(core.read())
    const resumed = accepted(respond(restored, answer))
    restored.confirm(resumed)
    expect(resumed.randomInputs).toEqual([0.75])
    expect(restored.read()).toMatchObject({
      revision: 2, progress: { kind: 'active', activeSeat: 'attacker' },
      state: { trace: ['before:0.25', ...result, 'after:0.75'] },
    })
  })

  it.each([
    ['second', 'first'],
    ['first', 'second'],
  ])('lets the responding seat choose the order %s then %s for a mandatory result', async (first, second) => {
    const core = await fixture({ mode: 'result', ids: ['first', 'second'], count: 3, ordered: true }).create()
    core.confirm(trigger(core))
    expect(core.read().progress).toMatchObject({
      kind: 'waiting', decision: { choices: { canPass: false, ordered: true, min: 2, max: 2 } },
    })
    expect(respond(core, { kind: 'pass' })).toMatchObject({ kind: 'rejected' })
    expect(respond(core, select(first, first))).toMatchObject({ kind: 'rejected' })
    const proposal = accepted(respond(core, select(first, second)))
    expect(proposal.match.state.trace).toEqual(['before:0.25', `${first},${second}`, 'resolved', 'after:0.75'])
  })

  it.each([
    { ids: ['huoya', 'sanzujinwu'] },
    { ids: ['huoya', 'sanzujinwu', 'bifang'] },
  ])('keeps $ids eligible for a fixed-one LG-08-style choice', async ({ ids }) => {
    const core = await fixture({ mode: 'result', ids, count: 1 }).create()
    core.confirm(trigger(core))
    expect(core.read().progress).toMatchObject({
      kind: 'waiting', decision: { choices: { candidates: ids.map(id => ({ id })), min: 1, max: 1 } },
    })
    expect(accepted(respond(core, select(ids[1]!))).match.state.trace).toEqual([
      'before:0.25', ids[1], 'resolved', 'after:0.75',
    ])
  })
})

function playerFixture(core: Core) {
  const records = new Map<string, CommandReceipt | CommandRequestSummary>()
  const checkpoints: History[] = []
  const recordKey = ({ seatId, commandId }: CommandRequestSummary['key']) => JSON.stringify([seatId, commandId])
  const store: PlayerCommandStore<CoreSnapshot, History> = {
    lookup: key => records.get(recordKey(key)),
    recordRejection: summary => { records.set(recordKey(summary.key), structuredClone(summary)) },
    confirm({ receipt, history }) {
      if (!history) throw new Error('Expected confirmation history')
      checkpoints.push(structuredClone(history))
      records.set(recordKey(receipt.key), structuredClone(receipt))
    },
  }
  let proposed: Accepted | undefined
  const adapter: PlayerCore<CoreSnapshot, History> = {
    project({ state }, scope): JsonValue {
      const decision = state.progress.kind === 'waiting' ? state.progress.decision : undefined
      if (decision && (decision.choices.visibility === 'public' || (scope.type === 'seat' && scope.seatId === decision.owner))) {
        const choices = projectEffectChoices(decision.choices)
        return { progress: state.progress.kind, decisionId: decision.id, candidates: choices.candidates.map(({ id }) => id) }
      }
      return { progress: state.progress.kind }
    },
    adjudicate({ action, seatId: seat, expectedRevision }) {
      const next = action.type === 'respond'
        ? core.propose({
          kind: 'decision', seat, expectedRevision, decisionId: action.decisionId,
          answer: action.choice.type === 'pass' ? { kind: 'pass' } : select(...action.choice.targetIds),
        })
        : core.propose({ kind: 'action', seat, expectedRevision, action })
      if (next.kind === 'rejected') return { status: 'rejected', reason: next.reason }
      proposed = next
      return {
        status: 'accepted', next: toConfirmedMatch(next.match), result: { progress: next.match.progress.kind },
        events: next.events.flatMap(event => event.type === 'effect-decision' ? [routeEffectDecisionEvent(event)] : []),
        history: { events: next.events, randomInputs: next.randomInputs },
      }
    },
    confirm() {
      if (!proposed) throw new Error('Expected proposed settlement')
      core.confirm(proposed)
      proposed = undefined
    },
  }
  const service = new PlayerInterface({ sessionId, confirmed: toConfirmedMatch(core.read()), core: adapter, store })

  async function connect(name: string, scope: ViewScope) {
    const messages: ServerMessage[] = []
    const port = service.connect(name, { send: message => messages.push(structuredClone(message)), close() {} })
    await port.receive({ type: 'hello', versions: PLAYER_PROTOCOL_V1 })
    expect(service.authorize(port, scope)).toBe(true)
    return {
      events: () => messages.flatMap(message => message.type === 'event' ? [message.event] : []),
      async view() {
        await port.receive({ type: 'request', interaction: 'M03', requestId: 'view', sessionId })
        const message = messages.at(-1)
        if (message?.type !== 'response' || message.interaction !== 'M03' || message.result.status !== 'ok') {
          throw new Error('Missing M03 view')
        }
        return message.result.view
      },
      async submit(commandId: string, basis: string, action: PlayerAction) {
        const seatId = scope.type === 'seat' ? scope.seatId : 'defender'
        const requestId = 'request-' + messages.length
        await port.receive({ type: 'request', interaction: 'M02', requestId, sessionId, commandId, seatId, basis, action })
        for (const message of messages) {
          if (message.type === 'response' && message.interaction === 'M02' && message.requestId === requestId) {
            return message.result
          }
        }
        throw new Error('Missing M02 response')
      },
    }
  }

  return { connect, checkpoints }
}

const attack = { type: 'attack', attackerId: 'fixture-attacker', targetId: 'fixture-defender' } as const
function answer(decisionId: string, ...targetIds: string[]): PlayerAction {
  return { type: 'respond', decisionId, choice: { type: 'select', targetIds } }
}

describe('FR-012 effect decisions in M02 and M04', () => {
  it('confirms an automatic choice with its trigger and returns a retry without publishing again', async () => {
    const core = await fixture({ mode: 'result', ids: ['only-candidate'], count: 3 }).create()
    const { connect, checkpoints } = playerFixture(core)
    const attacker = await connect('attacker', { type: 'seat', seatId: 'attacker' })
    const observer = await connect('spectator', { type: 'spectator' })
    const basis = (await attacker.view()).basis
    const receipt = await attacker.submit('one-resolution', basis, attack)
    expect(receipt.status).toBe('accepted')
    expect(await attacker.submit('one-resolution', basis, attack)).toEqual(receipt)
    expect(core.read()).toMatchObject({
      revision: 1, progress: { kind: 'active', activeSeat: 'attacker' },
      state: { trace: ['before:0.25', 'only-candidate', 'resolved', 'after:0.75'] },
    })
    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0]?.events.filter(event => event.type === 'effect-decision')).toEqual([
      expect.objectContaining({
        type: 'effect-decision', stage: 'resolved', resolution: 'automatic', answer: select('only-candidate'),
      }),
    ])
    expect(attacker.events()).toHaveLength(1)
    expect(observer.events()).toEqual(attacker.events())
  })

  it.each(['public', 'owner'] as const)('projects %s decision events, logs their resolution, and settles command IDs once', async visibility => {
    const core = await fixture({
      mode: 'result', ids: ['private-candidate'], count: 1, canPass: true, visibility,
    }).create()
    const { connect, checkpoints } = playerFixture(core)
    const attacker = await connect('attacker', { type: 'seat', seatId: 'attacker' })
    const defender = await connect('defender', { type: 'seat', seatId: 'defender' })
    const spectator = await connect('spectator', { type: 'spectator' })
    const triggerBasis = (await attacker.view()).basis
    const first = await attacker.submit('attack', triggerBasis, attack)
    expect(first.status).toBe('accepted')
    expect(await attacker.submit('attack', triggerBasis, attack)).toEqual(first)
    expect(checkpoints).toHaveLength(1)
    const progress = core.read().progress
    if (progress.kind !== 'waiting') throw new Error('Expected response window')
    const choice = answer(progress.decision.id, 'private-candidate')
    const responseBasis = (await defender.view()).basis
    expect(await spectator.submit('spectator-answer', (await spectator.view()).basis, choice))
      .toMatchObject({ status: 'rejected', reason: 'unauthorized' })
    expect(await defender.submit('invalid', responseBasis, answer(progress.decision.id, 'unknown')))
      .toMatchObject({ status: 'rejected' })
    const resolved = await defender.submit('resolve', responseBasis, choice)
    expect(resolved.status).toBe('accepted')
    expect(await defender.submit('resolve', responseBasis, choice)).toEqual(resolved)
    expect(await defender.submit('new-id', (await defender.view()).basis, choice))
      .toMatchObject({ status: 'rejected', reason: 'decision-expired' })
    expect(await defender.submit('invalid', responseBasis, answer(progress.decision.id, 'unknown')))
      .toMatchObject({ status: 'rejected', reason: 'decision-expired' })
    expect(await defender.submit('invalid', responseBasis, choice))
      .toMatchObject({ status: 'rejected', reason: 'command-id-conflict' })
    expect(core.read()).toMatchObject({
      revision: 2, state: { trace: ['before:0.25', 'private-candidate', 'resolved', 'after:0.75'] },
    })
    expect(checkpoints.map(({ randomInputs }) => randomInputs)).toEqual([[0.25], [0.75]])
    expect(checkpoints.flatMap(({ events }) => events)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'effect-decision', stage: 'offered' }),
      expect.objectContaining({
        type: 'effect-decision', stage: 'resolved', answer: select('private-candidate'),
      }),
    ]))
    const ownerEvents = defender.events()
    expect(ownerEvents).toHaveLength(2)
    expect(ownerEvents).toEqual([
      expect.objectContaining({ type: 'decision', payload: expect.objectContaining({ stage: 'offered' }) }),
      expect.objectContaining({ type: 'decision', payload: expect.objectContaining({ stage: 'resolved' }) }),
    ])
    expect(JSON.stringify(ownerEvents)).toContain('private-candidate')
    if (visibility === 'public') {
      expect(attacker.events()).toEqual(ownerEvents)
      expect(spectator.events()).toEqual(ownerEvents)
    } else {
      expect(JSON.stringify(attacker.events())).not.toContain('private-candidate')
      expect(JSON.stringify(spectator.events())).not.toContain('private-candidate')
    }
  })
})

describe('LG-08 sampling order and the public decision process', () => {
  const sampledIds = ['zinc', 'amber', 'cobalt'] as const
  const canonicalIds = ['amber', 'cobalt', 'zinc'] as const

  it.each([
    { ordered: false, canPass: false, selected: canonicalIds, resolution: 'automatic' },
    { ordered: false, canPass: true, selected: canonicalIds, resolution: 'answer' },
    { ordered: true, canPass: false, selected: ['cobalt', 'zinc', 'amber'], resolution: 'answer' },
  ])('does not publish internal sampling order for $resolution (ordered=$ordered)', async ({
    ordered, canPass, selected, resolution,
  }) => {
    const core = await fixture({ mode: 'result', ids: sampledIds, count: 3, ordered, canPass }).create()
    const { connect, checkpoints } = playerFixture(core)
    const attacker = await connect('attacker', { type: 'seat', seatId: 'attacker' })
    const defender = await connect('defender', { type: 'seat', seatId: 'defender' })
    const observer = await connect('spectator', { type: 'spectator' })
    expect((await attacker.submit('sample', (await attacker.view()).basis, attack)).status).toBe('accepted')

    const progress = core.read().progress
    if (resolution === 'answer') {
      if (progress.kind !== 'waiting') throw new Error('Expected answer after sampling')
      expect(progress.decision.choices.candidates.map(({ id }) => id)).toEqual(sampledIds)
      const responderView = await defender.view()
      for (const client of [attacker, defender, observer]) {
        expect((await client.view()).snapshot).toMatchObject({ candidates: canonicalIds })
        expect(client.events()).toEqual([
          expect.objectContaining({ payload: expect.objectContaining({
            stage: 'offered', choices: expect.objectContaining({ candidates: canonicalIds.map(id => ({ id })) }),
          }) }),
        ])
      }
      const submitted = answer(progress.decision.id, 'cobalt', 'zinc', 'amber')
      expect((await defender.submit('resolve-sample', responderView.basis, submitted)).status).toBe('accepted')
    }

    const publicResult = expect.objectContaining({ payload: expect.objectContaining({
      stage: 'resolved', resolution, choices: expect.objectContaining({ candidates: canonicalIds.map(id => ({ id })) }),
      answer: select(...selected),
    }) })
    for (const client of [attacker, defender, observer]) {
      const wireEvents = client.events()
      expect(wireEvents).toHaveLength(resolution === 'answer' ? 2 : 1)
      expect(wireEvents.at(-1)).toEqual(publicResult)
      expect(wireEvents).toEqual(observer.events())
    }
    const internalResolved = checkpoints.at(-1)?.events.find(event => event.type === 'effect-decision')
    expect(internalResolved).toMatchObject({
      choices: { candidates: sampledIds.map(id => ({ id })) },
      answer: select(...(ordered ? selected : sampledIds)),
    })
  })
})
