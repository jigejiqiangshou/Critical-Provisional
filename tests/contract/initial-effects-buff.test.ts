import { expect, it } from 'vitest'
import { initialEffectDefinitions } from '../../src/deck-catalog/effect-definitions'
import { createOfficialSeatState, createOfficialSnapshot, officialRules, OFFICIAL_RULES_VERSION } from '../../src/match/rules'
import type { OfficialMatchState, OfficialUnit } from '../../src/match/rules'
import type { Card, Release } from '../../src/deck-catalog/catalog'

it.each([
  ['烈焰奔袭', 1, 0, 0], ['木甲', 3, 3, 0], ['春雨', 1, 1, 1], ['青翠', 2, 2, 0],
  ['句芒', 2, 2, 0], ['青龙·孟章', 2, 2, 0],
] as const)('%s buffs only a legal own target and expires attack buff', (name, attack, health, shield) => {
  const entry = initialEffectDefinitions.find(item => item.legacyName === name && (item.trigger === 'skill' || item.trigger === 'play'))!
  const skill = entry.trigger === 'skill'
  const cards: Card[] = [
    { id: entry.cardId, name, kind: skill ? 'unit' : 'spell', flagship: false,
      data: { attr: '青龙', attack: 1, health: 1, skill: { id: 'skill' }, effects: [{ trigger: entry.trigger, steps: entry.steps }] } },
    { id: 'red', name: 'red', kind: 'unit', flagship: false, data: { attr: '朱雀', health: 5 } },
    { id: 'blue', name: 'blue', kind: 'unit', flagship: false, data: { attr: '玄武', health: 5 } },
  ]
  const release: Release = { id: 'buff-test', rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] }
  const snapshot = createOfficialSnapshot(release)
  const unit = (id: string, cardId: string): OfficialUnit => ({ id, cardId, hp: 2, canAttack: false, attacked: false,
    skillUsed: false, skillLock: false, attackBonus: 0, deathAttackBonus: 0, stealth: false, stunned: false, shield: 0 })
  const a = createOfficialSeatState(), b = createOfficialSeatState()
  a.board = [unit('own', 'red'), unit('wrong-attr', 'blue')]
  b.board = [unit('enemy', 'red')]
  if (skill) a.board.push(unit('source', entry.cardId))
  else a.hand = [{ id: 'source', cardId: entry.cardId }]
  const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: b }, turn: 2,
    finale: null, battleMode: false, effect: null }
  const invoke = (target: string) => officialRules.resolveAction({ state, snapshot, seat: 'A', random: () => 0,
    action: skill ? { type: 'activate-skill', sourceId: 'source', skillId: 'skill', targets: [target] }
      : { type: 'play-card', cardId: 'source', targets: [target] } })
  expect(invoke('enemy').kind).toBe('rejected')
  if (name === '烈焰奔袭') expect(invoke('wrong-attr').kind).toBe('rejected')
  const result = invoke('own')
  expect(result.kind).toBe('active')
  if (result.kind !== 'active') throw new Error('expected settlement')
  const own = result.state.seats.A.board.find(card => card.id === 'own')!
  expect(own).toMatchObject({ attackBonus: attack, hp: 2 + health, shield })
  if (name === '烈焰奔袭') expect(own.canAttack).toBe(true)
  if (name === '句芒') expect(result.state.seats.A.fieldLock).toBe('青龙')
  if (name === '春雨') {
    const events = result.events.flatMap(event => event.type === 'rule-event' ? [event.name] : [])
    expect(events.indexOf('unit-buffed')).toBeLessThan(events.indexOf('unit-shielded'))
  }
  const injured = structuredClone(result.state)
  injured.seats.A.board.find(card => card.id === 'own')!.hp -= 1
  const ended = officialRules.resolveAction({ state: injured, snapshot, seat: 'A', random: () => 0, action: { type: 'end-turn' } })
  if (ended.kind !== 'active') throw new Error('expected turn end')
  expect(ended.state.seats.A.board.find(card => card.id === 'own')).toMatchObject({ attackBonus: 0, hp: 1 + health })
})

it.each(['attacked', 'stunned'] as const)('烈焰奔袭 does not permit an already %s unit to attack', condition => {
  const entry = initialEffectDefinitions.find(item => item.legacyName === '烈焰奔袭')!
  const cards: Card[] = [
    { id: entry.cardId, name: entry.legacyName, kind: 'spell', flagship: false,
      data: { effects: [{ trigger: entry.trigger, steps: entry.steps }] } },
    { id: 'target', name: 'target', kind: 'unit', flagship: false, data: { attr: '朱雀', attack: 2, health: 2 } },
  ]
  const snapshot = createOfficialSnapshot({ id: 'rush-test', rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] })
  const a = createOfficialSeatState(), b = createOfficialSeatState()
  a.ap = 1; a.hand = [{ id: 'spell', cardId: entry.cardId }]
  a.board = [{ id: 'unit', cardId: 'target', hp: 2, canAttack: false, attacked: condition === 'attacked',
    stunned: condition === 'stunned', skillUsed: false, skillLock: false, attackBonus: 0, deathAttackBonus: 0, stealth: false, shield: 0 }]
  const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: b }, turn: 2, finale: null, battleMode: false, effect: null }
  const result = officialRules.resolveAction({ state, snapshot, seat: 'A', random: () => 0,
    action: { type: 'play-card', cardId: 'spell', targets: ['unit'] } })
  if (result.kind !== 'active') throw new Error('expected spell settlement')
  expect(officialRules.resolveAction({ state: result.state, snapshot, seat: 'A', random: () => 0,
    action: { type: 'attack', attackerId: 'unit', targetId: 'core:B' } })).toMatchObject({ kind: 'rejected', reason: 'attacker-unavailable' })
})
