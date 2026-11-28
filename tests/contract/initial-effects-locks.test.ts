import { expect, it } from 'vitest'
import { initialEffectDefinitions } from '../../src/deck-catalog/effect-definitions'
import { coreTargetId, createOfficialSeatState, createOfficialSnapshot, officialRules, OFFICIAL_RULES_VERSION } from '../../src/match/rules'
import type { OfficialMatchState, OfficialUnit } from '../../src/match/rules'
import type { Card, Release } from '../../src/deck-catalog/catalog'

function build(name: string) {
  const effect = initialEffectDefinitions.find(item => item.legacyName === name)!
  const cards: Card[] = [
    { id: effect.cardId, name, kind: 'spell', flagship: false, data: { attr: '朱雀', effects: [{ trigger: effect.trigger, steps: effect.steps }] } },
    { id: 'same', name: 'same', kind: 'spell', flagship: false, data: { attr: '朱雀', effects: [{ trigger: 'play', steps: [{ type: 'heal-core', amount: 1 }] }] } },
    { id: 'other', name: 'other', kind: 'spell', flagship: false, data: { attr: '白虎', effects: [{ trigger: 'play', steps: [{ type: 'heal-core', amount: 1 }] }] } },
    { id: 'unit', name: 'unit', kind: 'unit', flagship: false, data: { attr: '朱雀', attack: 2, health: 1, skill: { id: 'skill' }, effects: [{ trigger: 'skill', steps: [{ type: 'heal-core', amount: 1 }] }] } },
  ]
  const release: Release = { id: 'lock-test', rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] }
  const a = createOfficialSeatState(), b = createOfficialSeatState()
  const unit = (id: string): OfficialUnit => ({ id, cardId: 'unit', hp: 1, canAttack: true, attacked: false,
    skillUsed: false, skillLock: false, attackBonus: 0, deathAttackBonus: 0, stealth: false, stunned: false, shield: 0 })
  a.ap = 1; b.ap = 1
  a.hand = [{ id: 'first', cardId: effect.cardId }, { id: 'same', cardId: 'same' }, { id: 'other', cardId: 'other' }]
  b.hand = [{ id: 'b-same', cardId: 'same' }]
  a.board = [unit('a-unit')]; b.board = [unit('b-unit')]
  const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: b }, turn: 2, finale: null, battleMode: false, effect: null }
  const snapshot = createOfficialSnapshot(release)
  const invoke = (state: OfficialMatchState, seat: string, action: Parameters<typeof officialRules.resolveAction>[0]['action']) =>
    officialRules.resolveAction({ state, snapshot, seat, action, random: () => 0 })
  return { state, invoke }
}

it('field lock rejects same-attribute spell and skill without affecting the other player, then expires', () => {
  const { state, invoke } = build('燎原')
  const start = invoke(state, 'A', { type: 'play-card', cardId: 'first' })
  expect(start.kind).toBe('active')
  if (start.kind !== 'active') throw new Error('not active')
  const locked = start.state
  const before = structuredClone(locked)
  expect(invoke(locked, 'A', { type: 'play-card', cardId: 'same' }).kind).toBe('rejected')
  expect(invoke(locked, 'A', { type: 'activate-skill', sourceId: 'a-unit', skillId: 'skill' }).kind).toBe('rejected')
  expect(locked).toEqual(before)
  expect(invoke(locked, 'A', { type: 'play-card', cardId: 'other' }).kind).toBe('active')
  expect(invoke(locked, 'B', { type: 'play-card', cardId: 'b-same' }).kind).toBe('active')
  const ended = invoke(locked, 'A', { type: 'end-turn' })
  if (ended.kind !== 'active') throw new Error('not active')
  expect(ended.state.seats.A.fieldLock).toBe(null)
  expect(invoke(ended.state, 'A', { type: 'play-card', cardId: 'same' }).kind).toBe('active')
})

it('湮灭 blocks only its owner’s attacks and clears the lock at turn end', () => {
  const { state, invoke } = build('湮灭')
  const start = invoke(state, 'A', { type: 'play-card', cardId: 'first', targets: ['b-unit'] })
  if (start.kind !== 'active') throw new Error('not active')
  const locked = start.state
  const before = structuredClone(locked)
  expect(invoke(locked, 'A', { type: 'attack', attackerId: 'a-unit', targetId: coreTargetId('B') }).kind).toBe('rejected')
  expect(locked).toEqual(before)
  expect(locked.seats.B.selfAttackLock).toBe(false)
  const ended = invoke(locked, 'A', { type: 'end-turn' })
  if (ended.kind !== 'active') throw new Error('not active')
  expect(ended.state.seats.A.selfAttackLock).toBe(false)
  expect(invoke(ended.state, 'A', { type: 'attack', attackerId: 'a-unit', targetId: coreTargetId('B') }).kind).toBe('active')
})
