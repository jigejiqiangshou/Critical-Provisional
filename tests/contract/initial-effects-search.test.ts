import { expect, it } from 'vitest'
import { MatchCore } from '../../src/match/core'
import { projectOfficialMatch } from '../../src/match/player-interface'
import { initialEffectDefinitions } from '../../src/deck-catalog/effect-definitions'
import { createOfficialSeatState, createOfficialSnapshot, officialRules, OFFICIAL_RULES_VERSION } from '../../src/match/rules'
import type { OfficialMatchState } from '../../src/match/rules'
import type { Card, Release } from '../../src/deck-catalog/catalog'

it.each([0, 1, 2, 3])('search handles %i matching candidates with exact result count and private projection', async count => {
  const definitions = initialEffectDefinitions.filter(item => item.legacyName === '征召')
  const source = definitions[0]
  const cards: Card[] = [
    { id: source.cardId, name: source.legacyName, kind: 'spell', flagship: false,
      data: { effects: [{ trigger: source.trigger, steps: [{ type: 'search-deck', amount: 2, kind: 'unit', attr: '朱雀' }] }] } },
    { id: 'match', name: 'match', kind: 'unit', flagship: false, data: { attr: '朱雀', health: 1 } },
    { id: 'wrong-kind', name: 'wrong-kind', kind: 'spell', flagship: false, data: { attr: '朱雀' } },
    { id: 'wrong-attr', name: 'wrong-attr', kind: 'unit', flagship: false, data: { attr: '玄武' } },
    { id: 'ace', name: 'ace', kind: 'ace', flagship: true, data: { attr: '朱雀' } },
  ]
  const release: Release = { id: 'search-test', rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] }
  const snapshot = createOfficialSnapshot(release)
  const deck = [ { id: 'wrong-1', cardId: 'wrong-kind' }, ...Array.from({ length: count }, (_, i) => ({ id: `match-${i}`, cardId: 'match' })),
    { id: 'wrong-2', cardId: 'wrong-attr' }, { id: 'wrong-3', cardId: 'ace' } ]
  const a = createOfficialSeatState(deck)
  a.hand = [{ id: 'source', cardId: source.cardId }]
  const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: createOfficialSeatState() },
    turn: 2, finale: null, battleMode: false, effect: null }
  const core = await MatchCore.create({ rules: officialRules, snapshot, state, activeSeat: 'A',
    random: { kind: 'recorded', inputs: [], consumed: 0 } })
  const offer = core.propose({ kind: 'action', seat: 'A', expectedRevision: 0,
    action: { type: 'play-card', cardId: 'source' } })
  if (offer.kind !== 'accepted') throw new Error('expected offer')
  core.confirm(offer)
  const pending = core.read()
  if (count <= 2) {
    expect(pending.progress.kind).toBe('active')
    expect(pending.state.seats.A.hand.map(card => card.id)).toEqual(Array.from({ length: count }, (_, i) => `match-${i}`))
    expect(pending.state.seats.A.deck.map(card => card.id)).toEqual(['wrong-1', 'wrong-2', 'wrong-3'])
    return
  }
  if (pending.progress.kind !== 'waiting') throw new Error('expected decision')
  expect(pending.progress.decision.choices).toMatchObject({ visibility: 'owner', canPass: false, ordered: false, min: 2, max: 2 })
  expect(pending.progress.decision.choices.candidates.map(card => card.id)).toEqual(['match-0', 'match-1', 'match-2'])
  expect(JSON.stringify(projectOfficialMatch(pending, snapshot, { type: 'spectator' }))).not.toContain('match-0')
  const decision = { kind: 'decision' as const, seat: 'A', expectedRevision: 1, decisionId: pending.progress.decision.id }
  expect(core.propose({ ...decision, answer: { kind: 'pass' } })).toMatchObject({ kind: 'rejected', reason: 'illegal-choice' })
  const selected = core.propose({ ...decision, answer: { kind: 'select', candidateIds: ['match-2', 'match-0'] } })
  if (selected.kind !== 'accepted') throw new Error('expected selected result')
  core.confirm(selected)
  expect(core.read().state.seats.A.hand.map(card => card.id).sort()).toEqual(['match-0', 'match-2'])
  expect(core.read().state.seats.A.deck.map(card => card.id)).toEqual(['wrong-1', 'match-1', 'wrong-2', 'wrong-3'])
})

it.each([
  ['name', { names: ['chosen'] }], ['evolution', { evoStage: 1 }], ['minimum evolution', { evoStageMin: 1 }],
  ['attack', { attackMin: 4 }], ['health', { healthMin: 6 }], ['keyword', { keyword: '守护' }],
] as const)('filters deck search by %s', async (_label, filter) => {
  const cards: Card[] = [
    { id: 'source', name: 'source', kind: 'spell', flagship: false,
      data: { effects: [{ trigger: 'play', steps: [{ type: 'search-deck', amount: 1, ...filter }] }] } },
    { id: 'yes', name: 'chosen', kind: 'unit', flagship: false,
      data: { evoStage: 1, attack: 4, health: 6, keywords: ['守护'] } },
    { id: 'no', name: 'other', kind: 'unit', flagship: false,
      data: { evoStage: 0, attack: 3, health: 5, keywords: [] } },
  ]
  const snapshot = createOfficialSnapshot({ id: 'filters', rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] })
  const a = createOfficialSeatState([{ id: 'yes', cardId: 'yes' }, { id: 'no', cardId: 'no' }])
  a.hand = [{ id: 'source', cardId: 'source' }]
  const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: createOfficialSeatState() },
    turn: 2, finale: null, battleMode: false, effect: null }
  const core = await MatchCore.create({ rules: officialRules, snapshot, state, activeSeat: 'A',
    random: { kind: 'recorded', inputs: [], consumed: 0 } })
  const result = core.propose({ kind: 'action', seat: 'A', expectedRevision: 0,
    action: { type: 'play-card', cardId: 'source' } })
  expect(result.kind).toBe('accepted')
  if (result.kind !== 'accepted') throw new Error('expected automatic result')
  expect(result.match.state.seats.A.hand.map(card => card.id)).toEqual(['yes'])
  expect(result.match.state.seats.A.deck.map(card => card.id)).toEqual(['no'])
})
