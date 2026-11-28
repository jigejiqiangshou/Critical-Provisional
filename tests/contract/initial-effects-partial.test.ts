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
  it.each([['燎原', 3, false], ['白虹', 4, true], ['祝融', 2, false], ['蓐收', 2, false]] as const)(
    '%s damages every enemy with correct shielding and sequential death', (name, damage, pierce) => {
      const entry = definition(name), victim = definition('毕方')
      const kind = entry.trigger === 'skill' ? 'unit' : 'spell'
      const cards: Card[] = [
        { id: entry.cardId, name, kind, flagship: false,
          data: { attack: 1, health: 1, skill: { id: 'skill' }, effects: [{ trigger: entry.trigger, steps: entry.steps }] } },
        { id: victim.cardId, name: victim.legacyName, kind: 'unit', flagship: false,
          data: { health: 1, effects: [{ trigger: victim.trigger, steps: victim.steps }] } },
      ]
      const release: Release = { id: 'partial', rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] }
      const a = createOfficialSeatState(), b = createOfficialSeatState([
        { id: 'draw-1', cardId: victim.cardId }, { id: 'draw-2', cardId: victim.cardId }])
      if (entry.trigger === 'skill') a.board = [unit('source', entry.cardId)]
      else a.hand = [{ id: 'source', cardId: entry.cardId }]
      b.board = [{ ...unit('first', victim.cardId), hp: 1 },
        { ...unit('shielded', victim.cardId), hp: 1, shield: damage },
        { ...unit('last', victim.cardId), hp: 1 }]
      const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: b }, turn: 2,
        finale: null, battleMode: false, effect: null }
      const action = entry.trigger === 'skill'
        ? { type: 'activate-skill' as const, sourceId: 'source', skillId: 'skill' }
        : { type: 'play-card' as const, cardId: 'source' }
      const result = officialRules.resolveAction({ state, snapshot: createOfficialSnapshot(release), seat: 'A',
        random: () => 0, action })
      expect(result.kind).toBe('active')
      if (result.kind !== 'active') throw new Error('expected settled action')
      expect(result.state.seats.B.board.map(card => card.id)).toEqual(pierce ? [] : ['shielded'])
      if (!pierce) expect(result.state.seats.B.board[0].shield).toBe(0)
      const events = result.events.flatMap(event => event.type === 'rule-event' ? [event.name] : [])
      expect(events.indexOf('unit-destroyed')).toBeLessThan(events.indexOf('draw'))
      expect(events.indexOf('draw')).toBeLessThan(events.lastIndexOf('unit-destroyed'))
    },
  )
  it('朱厌 pre-strikes through a shield, and does not hit again after a pre-strike kill', () => {
    const entry = definition('朱厌')
    const cards: Card[] = [
      { id: entry.cardId, name: entry.legacyName, kind: 'unit', flagship: false,
        data: { attack: 5, health: 4, effects: [{ trigger: entry.trigger, steps: entry.steps }] } },
      { id: 'target', name: 'target', kind: 'unit', flagship: false, data: { attack: 1, health: 10 } },
    ]
    const release: Release = { id: 'partial', rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] }
    for (const hp of [1, 10]) {
      const a = createOfficialSeatState(), b = createOfficialSeatState()
      a.ap = 1
      a.board = [{ ...unit('attacker', entry.cardId), canAttack: true }]
      b.board = [{ ...unit('defender', 'target'), hp, shield: 10 }]
      const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: b }, turn: 2,
        finale: null, battleMode: false, effect: null }
      const result = officialRules.resolveAction({ state, snapshot: createOfficialSnapshot(release), seat: 'A',
        random: () => 0, action: { type: 'attack', attackerId: 'attacker', targetId: 'defender' } })
      expect(result.kind).toBe('active')
      if (result.kind !== 'active') throw new Error('expected settled action')
      const hitEvents = result.events.filter(event => event.type === 'rule-event' && event.name === 'unit-damaged')
      expect(hitEvents).toHaveLength(hp === 1 ? 1 : 2)
      if (hp === 1) expect(result.state.seats.B.board).toHaveLength(0)
      else expect(result.state.seats.B.board[0]).toMatchObject({ hp: 9, shield: 5 })
    }
  })
  it('朱厌 core pre-strike bypasses shield and a lethal pre-strike suppresses the normal hit', () => {
    const entries = initialEffectDefinitions.filter(item => item.legacyName === '朱厌')
    const card: Card = { id: entries[0].cardId, name: '朱厌', kind: 'unit', flagship: false,
      data: { attack: 5, health: 4, effects: entries.map(entry => ({ trigger: entry.trigger, steps: entry.steps })) } }
    const release: Release = { id: 'partial', rulesVersion: OFFICIAL_RULES_VERSION, cards: [card], presets: [] }
    for (const hp of [1, 50]) {
      const a = createOfficialSeatState(), b = createOfficialSeatState()
      a.ap = 1; a.board = [{ ...unit('attacker', card.id), canAttack: true }]
      b.hp = hp; b.coreShield = 10
      const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: b }, turn: 2,
        finale: null, battleMode: false, effect: null }
      const result = officialRules.resolveAction({ state, snapshot: createOfficialSnapshot(release), seat: 'A',
        random: () => 0, action: { type: 'attack', attackerId: 'attacker', targetId: coreTargetId('B') } })
      expect(['active', 'ended']).toContain(result.kind)
      if (result.kind !== 'active' && result.kind !== 'ended') throw new Error('expected settlement')
      expect(result.state.seats.B.hp).toBe(hp - 1)
      expect(result.state.seats.B.coreShield).toBe(hp === 1 ? 10 : 5)
      expect(result.events.filter(event => event.type === 'rule-event' && event.name === 'core-damaged')).toHaveLength(hp === 1 ? 1 : 2)
    }
  })
  it.each(['朱厌', '金乌'])('镇岳 cancels %s attack including its pre-strike or bonus', name => {
    const entries = initialEffectDefinitions.filter(item => item.legacyName === name)
    const trap = definition('镇岳')
    const cards: Card[] = [
      { id: entries[0].cardId, name, kind: 'unit', flagship: false,
        data: { attack: 5, health: 4, effects: entries.map(entry => ({ trigger: entry.trigger, steps: entry.steps })) } },
      { id: trap.cardId, name: '镇岳', kind: 'trap', flagship: false,
        data: { effects: [{ trigger: trap.trigger, steps: trap.steps }] } },
    ]
    const release: Release = { id: 'partial', rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] }
    const a = createOfficialSeatState(), b = createOfficialSeatState()
    a.ap = 1; a.board = [{ ...unit('attacker', entries[0].cardId), canAttack: true }]
    b.facedown = [{ id: 'trap', cardId: trap.cardId }]; b.coreShield = 10
    const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: b }, turn: 2,
      finale: null, battleMode: false, effect: null }
    const snapshot = createOfficialSnapshot(release)
    const waiting = officialRules.resolveAction({ state, snapshot, seat: 'A', random: () => 0,
      action: { type: 'attack', attackerId: 'attacker', targetId: coreTargetId('B') } })
    expect(waiting.kind).toBe('waiting')
    if (waiting.kind !== 'waiting') throw new Error('expected response window')
    const result = officialRules.resumeDecision({ state: waiting.state, snapshot, seat: 'B', random: () => 0,
      decision: { id: 'decision', ...waiting.decision }, answer: { kind: 'select', candidateIds: ['trap'] } })
    expect(result.kind).toBe('active')
    if (result.kind !== 'active') throw new Error('expected settled action')
    expect(result.state.seats.B.hp).toBe(50)
    expect(result.state.seats.B.coreShield).toBe(10)
    expect(result.events.filter(event => event.type === 'rule-event' && event.name === 'core-damaged')).toHaveLength(0)
  })
  it('白泽 skill draws once and cannot be reused in the same turn', () => {
    const entry = definition('白泽')
    const cards: Card[] = [
      { id: entry.cardId, name: '白泽', kind: 'unit', flagship: false,
        data: { attack: 2, health: 3, skill: { id: 'skill', oncePerTurn: true },
          effects: [{ trigger: entry.trigger, steps: entry.steps }] } },
      { id: 'filler', name: 'filler', kind: 'unit', flagship: false, data: { attack: 1, health: 1 } },
    ]
    const release: Release = { id: 'partial', rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] }
    const a = createOfficialSeatState([{ id: 'first', cardId: 'filler' }, { id: 'second', cardId: 'filler' }])
    a.board = [unit('source', entry.cardId)]
    const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: createOfficialSeatState() },
      turn: 2, finale: null, battleMode: false, effect: null }
    const snapshot = createOfficialSnapshot(release)
    const invoke = (position: OfficialMatchState) => officialRules.resolveAction({ state: position, snapshot, seat: 'A',
      random: () => 0, action: { type: 'activate-skill', sourceId: 'source', skillId: 'skill' } })
    const result = invoke(state)
    expect(result.kind).toBe('active')
    if (result.kind !== 'active') throw new Error('expected settlement')
    expect(result.state.seats.A.hand.map(card => card.id)).toEqual(['first'])
    expect(invoke(result.state)).toMatchObject({ kind: 'rejected', reason: 'skill-already-used' })
  })
  it('maps 离火 to five damage against an enemy unit', () => {
    expect(definition('离火')).toMatchObject({ trigger: 'play', steps: [{ type: 'damage-unit', amount: 5, target: 'enemy' }] })
  })
})
