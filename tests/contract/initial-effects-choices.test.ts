import { expect, it } from 'vitest'
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
