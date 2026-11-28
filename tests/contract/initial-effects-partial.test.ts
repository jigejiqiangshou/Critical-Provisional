import { describe, expect, it } from 'vitest'
import { initialEffectDefinitions } from '../../src/deck-catalog/effect-definitions'
import { coreTargetId, createOfficialSeatState, createOfficialSnapshot, officialRules, OFFICIAL_RULES_VERSION } from '../../src/match/rules'
import type { OfficialMatchState, OfficialUnit } from '../../src/match/rules'
import type { Card, Release } from '../../src/deck-catalog/catalog'

function definition(name: string) {
  const found = initialEffectDefinitions.find(entry => entry.legacyName === name)
  if (!found) throw new Error(`missing definition ${name}`)
  return found
}
function unit(id: string, cardId: string): OfficialUnit {
  return { id, cardId, hp: 1, canAttack: false, attacked: false, skillUsed: false, skillLock: false,
    attackBonus: 0, deathAttackBonus: 0, stealth: false, stunned: false, shield: 0 }
}

describe('partial T045 definitions: core settlement samples', () => {
  it.each(['毕方', '冰夷', '青苗'])('%s triggers its own owner draw before the spell draw', name => {
    const pulse = definition('炎纹')
    const victim = definition(name)
    const cards: Card[] = [
      { id: pulse.cardId, name: pulse.legacyName, kind: 'spell', flagship: false,
        data: { effects: [{ trigger: pulse.trigger, steps: pulse.steps }] } },
      { id: victim.cardId, name: victim.legacyName, kind: 'unit', flagship: false,
        data: { attack: 2, health: 1, effects: [{ trigger: victim.trigger, steps: victim.steps }] } },
      { id: 'filler', name: 'filler', kind: 'unit', flagship: false, data: { attack: 1, health: 1 } },
    ]
    const release: Release = { id: 'partial', rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] }
    const a = createOfficialSeatState([{ id: 'a-draw', cardId: 'filler' }])
    const b = createOfficialSeatState([{ id: 'b-draw', cardId: 'filler' }])
    a.hand = [{ id: 'pulse', cardId: pulse.cardId }]
    b.board = [unit('victim', victim.cardId)]
    const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: b }, turn: 2,
      finale: null, battleMode: false, effect: null }
    const result = officialRules.resolveAction({ state, snapshot: createOfficialSnapshot(release), seat: 'A',
      random: () => 0, action: { type: 'play-card', cardId: 'pulse', targets: ['victim'] } })
    expect(result.kind).toBe('active')
    if (result.kind !== 'active') throw new Error('expected settled action')
    expect(result.state.seats.B.board).toHaveLength(0)
    expect(result.state.seats.B.hand.map(card => card.id)).toEqual(['b-draw'])
    expect(result.state.seats.A.hand.map(card => card.id)).toEqual(['a-draw'])
    const events = result.events.flatMap(event => event.type === 'rule-event' ? [event.name] : [])
    expect(events.indexOf('unit-destroyed')).toBeLessThan(events.indexOf('draw'))
    const drawSeats = result.events.flatMap(event => event.type === 'rule-event' && event.name === 'draw'
      ? [(event.data as { seat: string }).seat] : [])
    expect(drawSeats).toEqual(['B', 'A'])
  })
  it.each([['青鸾', 'enter', 1], ['传讯', 'play', 1], ['洞察', 'play', 2]] as const)(
    '%s applies its draw when the card is played', (name, trigger, amount) => {
      const entry = definition(name)
      expect(entry.trigger).toBe(trigger)
      const cards: Card[] = [
        { id: entry.cardId, name, kind: trigger === 'enter' ? 'unit' : 'spell', flagship: false,
          data: { attack: 1, health: 1, effects: [{ trigger: entry.trigger, steps: entry.steps }] } },
        { id: 'filler', name: 'filler', kind: 'unit', flagship: false, data: { attack: 1, health: 1 } },
      ]
      const release: Release = { id: 'partial', rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] }
      const a = createOfficialSeatState([{ id: 'draw-1', cardId: 'filler' }, { id: 'draw-2', cardId: 'filler' }])
      a.hand = [{ id: 'played', cardId: entry.cardId }]
      const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: createOfficialSeatState() },
        turn: 2, finale: null, battleMode: false, effect: null }
      const result = officialRules.resolveAction({ state, snapshot: createOfficialSnapshot(release), seat: 'A',
        random: () => 0, action: { type: 'play-card', cardId: 'played' } })
      expect(result.kind).toBe('active')
      if (result.kind !== 'active') throw new Error('expected settled action')
      expect(result.state.seats.A.hand.map(card => card.id)).toEqual(['draw-1', 'draw-2'].slice(0, amount))
    },
  )
  it.each([['春风', 5], ['复苏', 8], ['回天', 12], ['麒麟', 3], ['龟息', 6]] as const)(
    '%s heals its owner and clamps at 50', (name, amount) => {
      const entry = definition(name)
      const kind = entry.trigger === 'enter' ? 'unit' : 'spell'
      const card: Card = { id: entry.cardId, name, kind, flagship: false,
        data: { attack: 1, health: 1, effects: [{ trigger: entry.trigger, steps: entry.steps }] } }
      const release: Release = { id: 'partial', rulesVersion: OFFICIAL_RULES_VERSION, cards: [card], presets: [] }
      for (const startingHp of [20, 49, 50]) {
        const a = createOfficialSeatState()
        a.hp = startingHp
        a.coreShield = 2
        a.hand = [{ id: 'played', cardId: entry.cardId }]
        const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: createOfficialSeatState() },
          turn: 2, finale: null, battleMode: false, effect: null }
        const result = officialRules.resolveAction({ state, snapshot: createOfficialSnapshot(release), seat: 'A',
          random: () => 0, action: { type: 'play-card', cardId: 'played' } })
        expect(result.kind).toBe('active')
        if (result.kind !== 'active') throw new Error('expected settled action')
        expect(result.state.seats.A.hp).toBe(Math.min(50, startingHp + amount))
        expect(result.state.seats.A.coreShield).toBe(name === '龟息' ? 5 : 2)
        if (name === '龟息' && startingHp < 50) {
          const events = result.events.flatMap(event => event.type === 'rule-event' ? [event.name] : [])
          expect(events.indexOf('core-healed')).toBeGreaterThanOrEqual(0)
          expect(events.indexOf('core-shielded')).toBeGreaterThan(events.indexOf('core-healed'))
        }
      }
    },
  )
  it.each(['三昧真火', '湮灭'])('%s destroys the selected enemy through shield and triggers death', name => {
    const spell = definition(name), victim = definition('毕方')
    const cards: Card[] = [
      { id: spell.cardId, name, kind: 'spell', flagship: false,
        data: { effects: [{ trigger: spell.trigger, steps: spell.steps }] } },
      { id: victim.cardId, name: victim.legacyName, kind: 'unit', flagship: false,
        data: { health: 1, effects: [{ trigger: victim.trigger, steps: victim.steps }] } },
    ]
    const release: Release = { id: 'partial', rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] }
    const a = createOfficialSeatState(), b = createOfficialSeatState([{ id: 'draw', cardId: victim.cardId }])
    a.hand = [{ id: 'spell', cardId: spell.cardId }]
    a.board = [unit('own', victim.cardId)]
    b.board = [{ ...unit('enemy', victim.cardId), hp: 100, shield: 100 }]
    const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: b }, turn: 2,
      finale: null, battleMode: false, effect: null }
    const invoke = (target: string) => officialRules.resolveAction({ state, snapshot: createOfficialSnapshot(release),
      seat: 'A', random: () => 0, action: { type: 'play-card', cardId: 'spell', targets: [target] } })
    expect(invoke('own').kind).toBe('rejected')
    const result = invoke('enemy')
    expect(result.kind).toBe('active')
    if (result.kind !== 'active') throw new Error('expected settled action')
    expect(result.state.seats.B.board).toHaveLength(0)
    expect(result.state.seats.B.discard.map(card => card.id)).toEqual(['enemy'])
    expect(result.state.seats.B.hand.map(card => card.id)).toEqual(['draw'])
    const events = result.events.flatMap(event => event.type === 'rule-event' ? [event.name] : [])
    expect(events.indexOf('unit-destroyed')).toBeLessThan(events.indexOf('draw'))
  })
  it.each([['金乌', 3, 2], ['三足金乌', 5, 2], ['天狼', 4, 1]] as const)(
    '%s applies its bonus to core attacks only and shields absorb it', (name, attack, bonus) => {
      const entry = definition(name)
      const attacker: Card = { id: entry.cardId, name, kind: 'unit', flagship: false,
        data: { attack, health: 5, effects: [{ trigger: entry.trigger, steps: entry.steps }] } }
      const defender: Card = { id: 'defender', name: 'defender', kind: 'unit', flagship: false,
        data: { attack: 1, health: 20 } }
      const release: Release = { id: 'partial', rulesVersion: OFFICIAL_RULES_VERSION, cards: [attacker, defender], presets: [] }
      const makeState = () => {
        const a = createOfficialSeatState(), b = createOfficialSeatState()
        a.ap = 1
        a.board = [{ ...unit('attacker', entry.cardId), hp: 5, canAttack: true }]
        b.coreShield = 2
        return { seatOrder: ['A', 'B'], seats: { A: a, B: b }, turn: 2, finale: null,
          battleMode: false, effect: null } satisfies OfficialMatchState
      }
      const state = makeState()
      const core = officialRules.resolveAction({ state, snapshot: createOfficialSnapshot(release), seat: 'A',
        random: () => 0, action: { type: 'attack', attackerId: 'attacker', targetId: coreTargetId('B') } })
      expect(core.kind).toBe('active')
      if (core.kind !== 'active') throw new Error('expected settled action')
      expect(core.state.seats.B.hp).toBe(50 - attack - bonus + 2)
      expect(core.state.seats.B.coreShield).toBe(0)
      const versus = makeState()
      versus.seats.B.board = [{ ...unit('target', defender.id), hp: 20 }]
      const target = officialRules.resolveAction({ state: versus, snapshot: createOfficialSnapshot(release), seat: 'A',
        random: () => 0, action: { type: 'attack', attackerId: 'attacker', targetId: 'target' } })
      expect(target.kind).toBe('active')
      if (target.kind !== 'active') throw new Error('expected settled action')
      expect(target.state.seats.B.board[0].hp).toBe(20 - attack)
    },
  )
  it('maps 离火 to five damage against an enemy unit', () => {
    expect(definition('离火')).toMatchObject({ trigger: 'play', steps: [{ type: 'damage-unit', amount: 5, target: 'enemy' }] })
  })
})
