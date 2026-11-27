// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { computeVersionHash, MatchCore } from '../../src/match/core'
import type { CoreCommand, MatchProposal, RandomState } from '../../src/match/core'
import type { CardPoolSnapshot, DecisionAnswer, Ruleset } from '../../src/match/rules'

type State = { readonly draws: readonly number[]; readonly picked: readonly string[] }
type Action = 'draw' | 'offer' | 'skip' | 'reject-after-draw' | 'throw-after-draw' | 'finish'
type Continuation = { readonly step: 'complete-offer'; readonly sample: number }
type Event = { readonly type: string; readonly value?: number | string }
type TestRules = Ruleset<State, Action, Continuation, Event>

const snapshot = {
  id: 'release-1',
  rulesVersion: 'rules-1',
  content: { cards: [{ id: 'shell', points: 4 }], title: 'initial' },
} satisfies CardPoolSnapshot
const initial: State = { draws: [], picked: [] }
const draws: RandomState = { kind: 'recorded', inputs: [0.125, 0.75, 0.5, 0.25, 0.375, 0.875], consumed: 0 }

function rulesFixture(): TestRules {
  return {
    version: 'rules-1',
    artifact: { logic: 'independent-fixture', properties: { x: 1, y: 2 } },
    resolveAction({ state, action, random, seat }) {
      if (action === 'skip') {
        return { kind: 'active', activeSeat: seat, state: { ...state }, events: [{ type: 'unconfirmed-notice' }] }
      }
      if (action === 'finish') {
        return { kind: 'ended', state, outcome: { winner: seat, reason: 'fixture-win' }, events: [{ type: 'finished' }] }
      }

      const first = random()
      switch (action) {
        case 'reject-after-draw':
          return { kind: 'rejected', reason: 'fixture-rejection' }
        case 'throw-after-draw':
          throw new Error('fixture rule failed')
        case 'draw': {
          const second = random()
          return {
            kind: 'active',
            activeSeat: seat,
            state: { ...state, draws: [...state.draws, first, second] },
            events: [{ type: 'first', value: first }, { type: 'second', value: second }],
          }
        }
        case 'offer':
          return {
            kind: 'waiting',
            state: { ...state, draws: [...state.draws, first] },
            events: [{ type: 'offer', value: first }],
            decision: {
              owner: 'west',
              choices: {
                candidates: [
                  { id: 'shell', payload: first },
                  { id: 'pearl' },
                ],
                min: 2,
                max: 2,
                canPass: false,
                ordered: true,
                visibility: 'owner',
              },
              continuation: { step: 'complete-offer', sample: first },
            },
          }
      }
    },
    resumeDecision({ state, decision, answer, random }) {
      const next = random()
      const picked = answer.kind === 'select' ? answer.candidateIds : []
      return {
        kind: 'active',
        activeSeat: 'east',
        state: { draws: [...state.draws, next], picked },
        events: [
          { type: decision.continuation.step, value: decision.continuation.sample },
          ...picked.map(value => ({ type: 'picked', value })),
          { type: 'resumed-draw', value: next },
        ],
      }
    },
  }
}

function match(rules = rulesFixture(), random = draws) {
  return MatchCore.create({ rules, state: initial, activeSeat: 'east', random, snapshot })
}

function action(action: Action, expectedRevision = 0, seat = 'east'): CoreCommand<Action> {
  return { kind: 'action', action, seat, expectedRevision }
}

function decision(answer: DecisionAnswer, seat = 'west', decisionId = 'decision-1'): CoreCommand<Action> {
  return { kind: 'decision', seat, decisionId, answer, expectedRevision: 1 }
}

function accepted(proposal: MatchProposal<State, Continuation, Event>) {
  if (proposal.kind !== 'accepted') throw new Error(`Expected a settlement, received ${proposal.reason}`)
  return proposal
}

describe('standalone match settlement', () => {
  it('runs in Node and locks a hash for actual rule and card pool content', async () => {
    expect(globalThis.document).toBeUndefined()
    const rules = rulesFixture()
    const core = await match(rules)
    const reordered = {
      rulesVersion: 'rules-1', id: 'release-1',
      content: { title: 'initial', cards: [{ points: 4, id: 'shell' }] },
    }

    const versionHash = core.read().versionHash
    expect(core.read().snapshotRef).toBe(snapshot.id)
    expect(versionHash).toMatch(/^[a-f0-9]{64}$/)
    await expect(computeVersionHash({ ...rules, artifact: { properties: { y: 2, x: 1 }, logic: 'independent-fixture' } }, reordered))
      .resolves.toBe(versionHash)
    await expect(computeVersionHash({ ...rules, artifact: { logic: 'different' } }, snapshot))
      .resolves.not.toBe(versionHash)
    await expect(computeVersionHash(rules, { ...snapshot, content: { cards: [{ id: 'shell', points: 5 }], title: 'initial' } }))
      .resolves.not.toBe(versionHash)
  })

  it('keeps authority unchanged until confirmation and accepts only one candidate at a revision', async () => {
    const core = await match()
    const other = await match()
    const before = core.read()
    const draw = accepted(core.propose(action('draw')))
    const offer = accepted(core.propose(action('offer')))

    expect(core.read()).toBe(before)
    expect(core.read()).toMatchObject({ revision: 0, state: initial, random: { consumed: 0 } })
    expect(draw.match.revision).toBe(1)
    expect(draw.randomInputs).toEqual([0.125, 0.75])
    expect(draw.events).toEqual([{ type: 'first', value: 0.125 }, { type: 'second', value: 0.75 }])
    expect(offer.randomInputs).toEqual([0.125])
    expect(Object.isFrozen(draw.match.state.draws)).toBe(true)
    expect(Object.isFrozen(draw.events[0])).toBe(true)
    expect(() => core.confirm(structuredClone(draw))).toThrow()
    expect(() => other.confirm(draw)).toThrow()
    expect(core.read()).toBe(before)

    core.confirm(draw)
    expect(core.read()).toBe(draw.match)
    expect(core.read().state.draws).toEqual([0.125, 0.75])
    expect(() => core.confirm(offer)).toThrow()
    expect(() => core.confirm(draw)).toThrow()
    expect(core.propose(action('draw'))).toEqual({ kind: 'rejected', reason: 'stale-revision' })
    expect(core.read()).toBe(draw.match)
  })

  it('does not advance authority on event-only, rejected, exceptional, or exhausted settlements', async () => {
    const core = await match(rulesFixture(), { kind: 'recorded', inputs: [0.125], consumed: 0 })
    const before = core.read()
    expect(core.propose(action('skip'))).toEqual({ kind: 'rejected', reason: 'no-state-change' })
    expect(core.propose(action('reject-after-draw'))).toEqual({ kind: 'rejected', reason: 'fixture-rejection' })
    expect(() => core.propose(action('throw-after-draw'))).toThrow('fixture rule failed')
    expect(core.propose(action('draw'))).toEqual({ kind: 'rejected', reason: 'random-input-exhausted' })
    expect(core.propose(action('offer', 0, 'west'))).toEqual({ kind: 'rejected', reason: 'wrong-seat' })
    expect(core.read()).toBe(before)
    expect(core.read().random.consumed).toBe(0)
    expect(accepted(core.propose(action('offer'))).randomInputs).toEqual([0.125])
  })

  it('restores the original decision ID, owner, continuation, and ordered random inputs', async () => {
    const rules = rulesFixture()
    const resume = vi.spyOn(rules, 'resumeDecision')
    const uninterrupted = await match(rules)
    const pause = accepted(uninterrupted.propose(action('offer')))
    uninterrupted.confirm(pause)
    const persisted = JSON.parse(JSON.stringify(uninterrupted.read()))
    const restored = await MatchCore.restore({ rules, snapshot, match: persisted })
    expect(restored.read()).toEqual(uninterrupted.read())
    expect(restored.read()).toMatchObject({
      revision: 1,
      progress: {
        kind: 'waiting',
        decision: {
          id: 'decision-1', owner: 'west', continuation: { step: 'complete-offer', sample: 0.125 },
          choices: { candidates: [{ id: 'shell', payload: 0.125 }, { id: 'pearl' }] },
        },
      },
      random: { consumed: 1 },
    })

    const valid = decision({ kind: 'select', candidateIds: ['pearl', 'shell'] })
    expect(restored.propose(action('draw', 1))).toMatchObject({ reason: 'decision-pending' })
    expect(restored.propose(decision({ kind: 'select', candidateIds: ['pearl', 'shell'] }, 'east')))
      .toMatchObject({ reason: 'wrong-seat' })
    expect(restored.propose(decision({ kind: 'select', candidateIds: ['pearl', 'shell'] }, 'west', 'decision-2')))
      .toMatchObject({ reason: 'decision-expired' })
    expect(restored.propose(decision({ kind: 'select', candidateIds: ['shell', 'shell'] })))
      .toMatchObject({ reason: 'illegal-choice' })
    expect(restored.propose(decision({ kind: 'pass' }))).toMatchObject({ reason: 'illegal-choice' })
    expect(resume).not.toHaveBeenCalled()
    expect(restored.read().random.consumed).toBe(1)

    const resumed = accepted(restored.propose(valid))
    expect(resumed).toEqual(accepted(uninterrupted.propose(valid)))
    expect(resumed.randomInputs).toEqual([0.75])
    expect(resumed.events).toEqual([
      { type: 'complete-offer', value: 0.125 },
      { type: 'picked', value: 'pearl' },
      { type: 'picked', value: 'shell' },
      { type: 'resumed-draw', value: 0.75 },
    ])
    restored.confirm(resumed)
    expect(restored.read()).toMatchObject({ revision: 2, random: { consumed: 2 }, state: { picked: ['pearl', 'shell'] } })
    expect(restored.propose(valid)).toMatchObject({ reason: 'decision-expired' })
    expect(accepted(restored.propose(action('offer', 2))).match.progress).toMatchObject({ decision: { id: 'decision-2' } })
  })

  it('reproduces seeded draws using a recorded tape and restores the seeded cursor', async () => {
    const rules = rulesFixture()
    const first = await match(rules, { kind: 'seeded', state: 2701, consumed: 0 })
    const firstDraw = accepted(first.propose(action('draw')))
    const second = await match(rules, { kind: 'seeded', state: 2701, consumed: 0 })
    expect(accepted(second.propose(action('draw')))).toEqual(firstDraw)
    first.confirm(firstDraw)

    const restored = await MatchCore.restore({ rules, snapshot, match: JSON.parse(JSON.stringify(first.read())) })
    const later = accepted(first.propose(action('draw', 1)))
    expect(accepted(restored.propose(action('draw', 1)))).toEqual(later)
    const replay = await match(rules, {
      kind: 'recorded', inputs: [...firstDraw.randomInputs, ...later.randomInputs], consumed: 0,
    })
    replay.confirm(accepted(replay.propose(action('draw'))))
    const reproduced = accepted(replay.propose(action('draw', 1)))
    expect(reproduced.events).toEqual(later.events)
    expect(reproduced.match.state).toEqual(later.match.state)
    expect(reproduced.randomInputs).toEqual(later.randomInputs)
  })

  it('distinguishes unavailable versions, hash mismatches, and incomplete history before executing rules', async () => {
    const rules = rulesFixture()
    const resolve = vi.spyOn(rules, 'resolveAction')
    const resume = vi.spyOn(rules, 'resumeDecision')
    const core = await match(rules)
    const persisted = core.read()

    await expect(MatchCore.restore({ rules, match: persisted })).rejects.toMatchObject({ reason: 'version-unavailable' })
    await expect(MatchCore.restore({ rules, snapshot: { ...snapshot, id: 'other' }, match: persisted }))
      .rejects.toMatchObject({ reason: 'version-unavailable' })
    await expect(MatchCore.restore({ rules, snapshot: { ...snapshot, content: null }, match: persisted }))
      .rejects.toMatchObject({ reason: 'version-hash-mismatch' })
    await expect(MatchCore.restore({ rules: { ...rules, artifact: null }, snapshot, match: persisted }))
      .rejects.toMatchObject({ reason: 'version-hash-mismatch' })
    await expect(MatchCore.restore({ rules, snapshot, match: { ...persisted, random: { ...persisted.random, consumed: 999 } } }))
      .rejects.toMatchObject({ reason: 'incomplete-record' })
    expect(resolve).not.toHaveBeenCalled()
    expect(resume).not.toHaveBeenCalled()
  })

  it('records a terminal transition with no further settlement', async () => {
    const core = await match()
    const finished = accepted(core.propose(action('finish')))
    expect(core.read().progress).toEqual({ kind: 'active', activeSeat: 'east' })
    core.confirm(finished)
    expect(core.read()).toMatchObject({ revision: 1, progress: { kind: 'ended', outcome: { winner: 'east', reason: 'fixture-win' } } })
    expect(core.propose(action('draw', 1))).toEqual({ kind: 'rejected', reason: 'match-ended' })
    expect(core.read()).toBe(finished.match)
  })
})
