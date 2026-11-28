import { describe, expect, it } from 'vitest'
import { initialEffectDefinitions } from '../../src/deck-catalog/effect-definitions'
import { createOfficialSeatState, createOfficialSnapshot, officialRules, OFFICIAL_RULES_VERSION } from '../../src/match/rules'
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
  it('maps 离火 to five damage against any unit', () => {
    expect(definition('离火')).toMatchObject({ trigger: 'play', steps: [{ type: 'damage-unit', amount: 5, target: 'any' }] })
  })
})
