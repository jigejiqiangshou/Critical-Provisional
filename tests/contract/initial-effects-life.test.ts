import { expect, it } from 'vitest'
import { MatchCore } from '../../src/match/core'
import { initialEffectDefinitions } from '../../src/deck-catalog/effect-definitions'
import { createOfficialSeatState, createOfficialSnapshot, officialRules, OFFICIAL_RULES_VERSION } from '../../src/match/rules'
import type { OfficialMatchState, OfficialUnit } from '../../src/match/rules'
import type { Card, Release } from '../../src/deck-catalog/catalog'

it.each([1, 2, 3, 4, 5, 50])('搏命 at %i life pays half, bypasses shield and leaves at least one life', async hp => {
  const entry = initialEffectDefinitions.find(item => item.legacyName === '搏命')!
  const cards: Card[] = [
    { id: entry.cardId, name: entry.legacyName, kind: 'spell', flagship: false,
      data: { effects: [{ trigger: entry.trigger, steps: entry.steps }] } },
    { id: 'filler', name: 'filler', kind: 'unit', flagship: false, data: { health: 1 } },
  ]
  const release: Release = { id: 'life-cost', rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] }
  const snapshot = createOfficialSnapshot(release)
  const a = createOfficialSeatState(Array.from({ length: 5 }, (_, i) => ({ id: `draw-${i}`, cardId: 'filler' })))
  a.hp = hp; a.coreShield = 10; a.hand = [{ id: 'source', cardId: entry.cardId }]
  const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: createOfficialSeatState() },
    turn: 2, finale: null, battleMode: false, effect: null }
  const result = officialRules.resolveAction({ state, snapshot, seat: 'A', random: () => 0, action: { type: 'play-card', cardId: 'source' } })
  expect(result.kind).toBe('active')
  if (result.kind !== 'active') throw new Error('expected settlement')
  expect(result.state.seats.A.hp).toBe(Math.max(1, hp - Math.max(1, Math.floor(hp / 2))))
  expect(result.state.seats.A.coreShield).toBe(10)
  expect(result.state.seats.A.hand).toHaveLength(5)
})

it('血涟 rejects unaffordable cost without state change; otherwise pays, shields, then offers a private search', async () => {
  const entry = initialEffectDefinitions.find(item => item.legacyName === '血涟')!
  const cards: Card[] = [
    { id: entry.cardId, name: entry.legacyName, kind: 'spell', flagship: false,
      data: { effects: [{ trigger: entry.trigger, steps: entry.steps }] } },
    { id: 'filler', name: 'filler', kind: 'unit', flagship: false, data: { health: 1, attr: '玄武' } },
  ]
  const snapshot = createOfficialSnapshot({ id: 'life-choice', rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] })
  const a = createOfficialSeatState([{ id: 'candidate-1', cardId: 'filler' }, { id: 'candidate-2', cardId: 'filler' }])
  a.hp = 3; a.coreShield = 10; a.hand = [{ id: 'source', cardId: entry.cardId }]
  const unit: OfficialUnit = { id: 'own', cardId: 'filler', hp: 1, canAttack: false, attacked: false,
    skillUsed: false, skillLock: false, attackBonus: 0, deathAttackBonus: 0, stealth: false, stunned: false, shield: 0 }
  a.board = [unit]
  const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: createOfficialSeatState() },
    turn: 2, finale: null, battleMode: false, effect: null }
  const core = await MatchCore.create({ rules: officialRules, snapshot, state, activeSeat: 'A',
    random: { kind: 'recorded', inputs: [0], consumed: 0 } })
  const action = { type: 'play-card' as const, cardId: 'source', targets: ['own'] }
  expect(core.propose({ kind: 'action', seat: 'A', expectedRevision: 0, action })).toMatchObject({ kind: 'rejected', reason: 'life-cost-unavailable' })
  expect(core.read().state.seats.A).toMatchObject({ hp: 3, coreShield: 10 })
  const eligible = structuredClone(state); eligible.seats.A.hp = 4
  const second = await MatchCore.create({ rules: officialRules, snapshot, state: eligible, activeSeat: 'A',
    random: { kind: 'recorded', inputs: [0], consumed: 0 } })
  const offer = second.propose({ kind: 'action', seat: 'A', expectedRevision: 0, action })
  if (offer.kind !== 'accepted') throw new Error('expected eligible settlement')
  expect(offer.match.state.seats.A).toMatchObject({ hp: 1, coreShield: 10 })
  expect(offer.match.state.seats.A.board[0].shield).toBe(3)
  expect(offer.match.progress.kind).toBe('waiting')
  const events = offer.events.flatMap(event => event.type === 'rule-event' ? [event.name] : [])
  expect(events.indexOf('life-paid')).toBeLessThan(events.indexOf('unit-shielded'))
  expect(events.indexOf('unit-shielded')).toBeLessThan(events.indexOf('cards-looked'))
})
