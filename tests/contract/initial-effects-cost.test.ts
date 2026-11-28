import { expect, it } from 'vitest'
import { MatchCore } from '../../src/match/core'
import { projectOfficialMatch } from '../../src/match/player-interface'
import { initialEffectDefinitions, assertInitialEffectsReady } from '../../src/deck-catalog/effect-definitions'
import type { InitialEffectDefinition } from '../../src/deck-catalog/effect-definitions'
import { createOfficialSeatState, createOfficialSnapshot, officialRules, OFFICIAL_RULES_VERSION } from '../../src/match/rules'
import type { OfficialMatchState, OfficialUnit } from '../../src/match/rules'
import type { Card, Release } from '../../src/deck-catalog/catalog'

it.each([0, 1, 2])('朱雀羽 optional death cost with %i hand candidates', async count => {
  const victim = initialEffectDefinitions.find(item => item.legacyName === '朱雀羽')!
  const cards: Card[] = [
    { id: victim.cardId, name: victim.legacyName, kind: 'unit', flagship: false,
      data: { health: 1, effects: [{ trigger: victim.trigger, steps: victim.steps }] } },
    { id: 'spell', name: 'spell', kind: 'spell', flagship: false,
      data: { effects: [{ trigger: 'play', steps: [{ type: 'destroy-unit', target: 'enemy' }] }] } },
    { id: 'filler', name: 'filler', kind: 'unit', flagship: false, data: { health: 1 } },
  ]
  const release: Release = { id: 'cost-test', rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] }
  const snapshot = createOfficialSnapshot(release)
  const a = createOfficialSeatState(), b = createOfficialSeatState([{ id: 'draw-1', cardId: 'filler' }, { id: 'draw-2', cardId: 'filler' }])
  a.hand = [{ id: 'spell', cardId: 'spell' }]
  b.hand = Array.from({ length: count }, (_, i) => ({ id: `secret-${i}`, cardId: 'filler' }))
  const unit: OfficialUnit = { id: 'victim', cardId: victim.cardId, hp: 1, canAttack: false, attacked: false,
    skillUsed: false, skillLock: false, attackBonus: 0, deathAttackBonus: 0, stealth: false, stunned: false, shield: 0 }
  b.board = [unit]
  const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: b }, turn: 2,
    finale: null, battleMode: false, effect: null }
  const core = await MatchCore.create({ rules: officialRules, snapshot, state, activeSeat: 'A',
    random: { kind: 'recorded', inputs: [], consumed: 0 } })
  const offer = core.propose({ kind: 'action', seat: 'A', expectedRevision: 0,
    action: { type: 'play-card', cardId: 'spell', targets: ['victim'] } })
  if (offer.kind !== 'accepted') throw new Error('expected settlement')
  core.confirm(offer)
  const pending = core.read()
  if (count === 0) {
    expect(pending.progress.kind).toBe('active')
    expect(pending.state.seats.B.hand).toHaveLength(0)
    expect(pending.state.seats.B.deck).toHaveLength(2)
    return
  }
  if (pending.progress.kind !== 'waiting') throw new Error('expected optional decision')
  expect(pending.progress.decision.choices).toMatchObject({ canPass: true, visibility: 'owner', min: 1, max: 1 })
  expect(JSON.stringify(projectOfficialMatch(pending, snapshot, { type: 'spectator' }))).not.toContain('secret-0')
  const command = { kind: 'decision' as const, seat: 'B', expectedRevision: 1, decisionId: pending.progress.decision.id }
  const pass = core.propose({ ...command, answer: { kind: 'pass' } })
  if (pass.kind !== 'accepted') throw new Error('expected pass')
  expect(pass.match.state.seats.B.hand).toHaveLength(count)
  expect(pass.match.state.seats.B.deck).toHaveLength(2)
  const select = core.propose({ ...command, answer: { kind: 'select', candidateIds: ['secret-0'] } })
  if (select.kind !== 'accepted') throw new Error('expected select')
  expect(select.match.state.seats.B.discard.map(card => card.id)).toEqual(['victim', 'secret-0'])
  expect(select.match.state.seats.B.hand.map(card => card.id)).toEqual([...Array.from({ length: count - 1 }, (_, i) => `secret-${i + 1}`), 'draw-1', 'draw-2'])
  const events = select.events.flatMap(event => event.type === 'rule-event' ? [event.name] : [])
  expect(events.indexOf('hand-discarded')).toBeLessThan(events.indexOf('draw'))
})

it('rejects an unimplemented nested cost continuation', () => {
  const list = initialEffectDefinitions as InitialEffectDefinition[]
  const original = list.find(item => item.legacyName === '朱雀羽')!
  const position = list.indexOf(original)
  list[position] = { ...original, steps: [{ type: 'hand-cost', amount: 1, canPass: true,
    onSelect: [{ type: 'unknown' } as never] }] }
  try { expect(() => assertInitialEffectsReady()).toThrow('Unimplemented effect: unknown') }
  finally { list[position] = original }
})

it('朱雀羽 response waits until all targets of a group effect have settled', async () => {
  const victim = initialEffectDefinitions.find(item => item.legacyName === '朱雀羽')!
  const aoe = initialEffectDefinitions.find(item => item.legacyName === '燎原')!
  const cards: Card[] = [
    { id: aoe.cardId, name: aoe.legacyName, kind: 'spell', flagship: false,
      data: { effects: [{ trigger: aoe.trigger, steps: aoe.steps }] } },
    { id: victim.cardId, name: victim.legacyName, kind: 'unit', flagship: false,
      data: { health: 1, effects: [{ trigger: victim.trigger, steps: victim.steps }] } },
    { id: 'other', name: 'other', kind: 'unit', flagship: false, data: { health: 1 } },
  ]
  const snapshot = createOfficialSnapshot({ id: 'deferred-death', rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] })
  const a = createOfficialSeatState(), b = createOfficialSeatState()
  a.hand = [{ id: 'aoe', cardId: aoe.cardId }]
  b.hand = [{ id: 'cost', cardId: 'other' }]
  const unit = (id: string, cardId: string): OfficialUnit => ({ id, cardId, hp: 1, canAttack: false, attacked: false,
    skillUsed: false, skillLock: false, attackBonus: 0, deathAttackBonus: 0, stealth: false, stunned: false, shield: 0 })
  b.board = [unit('first', victim.cardId), unit('second', 'other')]
  const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: b }, turn: 2,
    finale: null, battleMode: false, effect: null }
  const core = await MatchCore.create({ rules: officialRules, snapshot, state, activeSeat: 'A', random: { kind: 'recorded', inputs: [], consumed: 0 } })
  const result = core.propose({ kind: 'action', seat: 'A', expectedRevision: 0, action: { type: 'play-card', cardId: 'aoe' } })
  expect(result.kind).toBe('accepted')
  if (result.kind !== 'accepted') throw new Error('expected settlement')
  expect(result.match.progress.kind).toBe('waiting')
  expect(result.match.state.seats.B.board).toHaveLength(0)
  expect(result.match.state.seats.B.discard.map(card => card.id)).toEqual(['first', 'second'])
})
