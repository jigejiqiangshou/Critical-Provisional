import { expect, it } from 'vitest'
import { MatchCore } from '../../src/match/core'
import { projectOfficialMatch } from '../../src/match/player-interface'
import { initialEffectDefinitions } from '../../src/deck-catalog/effect-definitions'
import { createOfficialSeatState, createOfficialSnapshot, officialRules, OFFICIAL_RULES_VERSION } from '../../src/match/rules'
import type { OfficialMatchState } from '../../src/match/rules'
import type { Card, Release } from '../../src/deck-catalog/catalog'

it.each(['共工', '渊瞳'])('%s resolves zero, one and multiple private discard candidates', name => {
  const entry = initialEffectDefinitions.find(item => item.legacyName === name)!
  const cards: Card[] = [
    { id: entry.cardId, name, kind: 'unit', flagship: false,
      data: { attack: 1, health: 1, effects: [{ trigger: entry.trigger, steps: entry.steps }] } },
    { id: 'filler', name: 'filler', kind: 'unit', flagship: false, data: { attack: 1, health: 1 } },
  ]
  const release: Release = { id: 'choice-test', rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] }
  const snapshot = createOfficialSnapshot(release)
  for (const count of [0, 1, 2]) {
    const a = createOfficialSeatState([{ id: 'draw', cardId: 'filler' }])
    a.hand = [{ id: 'source', cardId: entry.cardId }, ...Array.from({ length: count }, (_, n) => ({ id: `candidate-${n}`, cardId: 'filler' }))]
    const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: createOfficialSeatState() },
      turn: 2, finale: null, battleMode: false, effect: null }
    const result = officialRules.resolveAction({ state, snapshot, seat: 'A', random: () => 0,
      action: { type: 'play-card', cardId: 'source' } })
    if (count < 2) {
      expect(result.kind).toBe('active')
      if (result.kind !== 'active') throw new Error('expected automatic settlement')
      expect(result.state.seats.A.discard.map(card => card.id)).toEqual(count ? ['candidate-0'] : [])
      if (name === '渊瞳') expect(result.state.seats.A.hand.map(card => card.id)).toEqual(['draw'])
      continue
    }
    expect(result.kind).toBe('waiting')
    if (result.kind !== 'waiting') throw new Error('expected decision')
    expect(result.decision.owner).toBe('A')
    expect(result.decision.choices).toMatchObject({ canPass: false, visibility: 'owner', min: 1, max: 1 })
    const decision = { id: 'discard-choice', ...result.decision }
    const resumed = officialRules.resumeDecision({ state: result.state, snapshot, seat: 'A', random: () => 0,
      decision, answer: { kind: 'select', candidateIds: ['candidate-1'] } })
    expect(resumed.kind).toBe('active')
    if (resumed.kind !== 'active') throw new Error('expected settlement')
    expect(resumed.state.seats.A.discard.map(card => card.id)).toEqual(['candidate-1'])
    if (name === '渊瞳') {
      expect(resumed.state.seats.A.hand.map(card => card.id)).toEqual(['candidate-0', 'draw'])
      const names = resumed.events.flatMap(event => event.type === 'rule-event' ? [event.name] : [])
      expect(names.indexOf('hand-discarded')).toBeLessThan(names.indexOf('draw'))
    }
  }
})

it('private discard is hidden from other scopes and core rejects passing before continuation', async () => {
  const entry = initialEffectDefinitions.find(item => item.legacyName === '渊瞳')!
  const cards: Card[] = [
    { id: entry.cardId, name: '渊瞳', kind: 'unit', flagship: false,
      data: { attack: 2, health: 4, effects: [{ trigger: entry.trigger, steps: entry.steps }] } },
    { id: 'filler', name: 'filler', kind: 'unit', flagship: false, data: { attack: 1, health: 1 } },
  ]
  const release: Release = { id: 'choice-test', rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] }
  const snapshot = createOfficialSnapshot(release)
  const a = createOfficialSeatState([{ id: 'draw', cardId: 'filler' }])
  a.hand = [{ id: 'source', cardId: entry.cardId }, { id: 'secret-1', cardId: 'filler' }, { id: 'secret-2', cardId: 'filler' }]
  const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: createOfficialSeatState() },
    turn: 2, finale: null, battleMode: false, effect: null }
  const core = await MatchCore.create({ rules: officialRules, snapshot, state, activeSeat: 'A',
    random: { kind: 'recorded', inputs: [], consumed: 0 } })
  const offer = core.propose({ kind: 'action', seat: 'A', expectedRevision: 0, action: { type: 'play-card', cardId: 'source' } })
  if (offer.kind !== 'accepted') throw new Error('expected confirmed choice')
  core.confirm(offer)
  const current = core.read()
  if (current.progress.kind !== 'waiting') throw new Error('expected waiting')
  const ownerView = JSON.stringify(projectOfficialMatch(current, snapshot, { type: 'seat', seatId: 'A' }))
  const opponentView = JSON.stringify(projectOfficialMatch(current, snapshot, { type: 'seat', seatId: 'B' }))
  const spectatorView = JSON.stringify(projectOfficialMatch(current, snapshot, { type: 'spectator' }))
  expect(ownerView).toContain('secret-1')
  expect(opponentView).not.toContain('secret-1')
  expect(spectatorView).not.toContain('secret-1')
  const answer = { kind: 'decision' as const, seat: 'A', expectedRevision: 1, decisionId: current.progress.decision.id }
  expect(core.propose({ ...answer, answer: { kind: 'pass' } })).toMatchObject({ kind: 'rejected', reason: 'illegal-choice' })
  expect(core.read()).toBe(current)
  const valid = core.propose({ ...answer, answer: { kind: 'select', candidateIds: ['secret-1'] } })
  expect(valid.kind).toBe('accepted')
})
