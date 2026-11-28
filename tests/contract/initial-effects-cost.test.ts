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
      data: { health: 1, effects: [{ trigger: victim.trigger, ...(victim.timing ? { timing: victim.timing } : {}), steps: victim.steps }] } },
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
      data: { health: 1, effects: [{ trigger: victim.trigger, ...(victim.timing ? { timing: victim.timing } : {}), steps: victim.steps }] } },
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

it('multiple 朱雀羽 deaths resolve deferred choices in order after restoration', async () => {
  const victim = initialEffectDefinitions.find(item => item.legacyName === '朱雀羽')!
  const aoe = initialEffectDefinitions.find(item => item.legacyName === '燎原')!
  const cards: Card[] = [
    { id: aoe.cardId, name: aoe.legacyName, kind: 'spell', flagship: false, data: { effects: [{ trigger: aoe.trigger, steps: aoe.steps }] } },
    { id: victim.cardId, name: victim.legacyName, kind: 'unit', flagship: false, data: { health: 1, effects: [{ trigger: victim.trigger, ...(victim.timing ? { timing: victim.timing } : {}), steps: victim.steps }] } },
  ]
  const snapshot = createOfficialSnapshot({ id: 'two-deaths', rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] })
  const a = createOfficialSeatState(), b = createOfficialSeatState([{ id: 'draw-1', cardId: victim.cardId }, { id: 'draw-2', cardId: victim.cardId }])
  a.hand = [{ id: 'aoe', cardId: aoe.cardId }]; b.hand = [{ id: 'cost', cardId: victim.cardId }]
  const unit = (id: string): OfficialUnit => ({ id, cardId: victim.cardId, hp: 1, canAttack: false, attacked: false,
    skillUsed: false, skillLock: false, attackBonus: 0, deathAttackBonus: 0, stealth: false, stunned: false, shield: 0 })
  b.board = [unit('first'), unit('second')]
  const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: b }, turn: 2, finale: null, battleMode: false, effect: null }
  const core = await MatchCore.create({ rules: officialRules, snapshot, state, activeSeat: 'A', random: { kind: 'recorded', inputs: [], consumed: 0 } })
  const initial = core.propose({ kind: 'action', seat: 'A', expectedRevision: 0, action: { type: 'play-card', cardId: 'aoe' } })
  if (initial.kind !== 'accepted') throw new Error('expected offer')
  core.confirm(initial)
  const saved = JSON.parse(JSON.stringify(core.read()))
  const restored = await MatchCore.restore({ rules: officialRules, snapshot, match: saved })
  const first = restored.read()
  if (first.progress.kind !== 'waiting') throw new Error('expected first choice')
  expect(first.state.seats.B.board).toHaveLength(0)
  const pass = restored.propose({ kind: 'decision', seat: 'B', expectedRevision: 1, decisionId: first.progress.decision.id, answer: { kind: 'pass' } })
  if (pass.kind !== 'accepted') throw new Error('expected pass')
  restored.confirm(pass)
  const second = restored.read()
  if (second.progress.kind !== 'waiting') throw new Error('expected second choice')
  expect(second.progress.decision.id).not.toBe(first.progress.decision.id)
  const select = restored.propose({ kind: 'decision', seat: 'B', expectedRevision: 2, decisionId: second.progress.decision.id,
    answer: { kind: 'select', candidateIds: ['cost'] } })
  if (select.kind !== 'accepted') throw new Error('expected selected result')
  restored.confirm(select)
  expect(restored.read().progress.kind).toBe('active')
  expect(restored.read().state.seats.B.hand.map(card => card.id)).toEqual(['draw-1', 'draw-2'])
})

it.each([['烽火令', 1, '朱雀'], ['寒渊', 2, '玄武'], ['虎符', 1, '白虎']] as const)(
  '%s requires full hand cost before searching', async (name, amount, attr) => {
    const entry = initialEffectDefinitions.find(item => item.legacyName === name)!
    const cards: Card[] = [
      { id: entry.cardId, name, kind: 'spell', flagship: false, data: { effects: [{ trigger: entry.trigger, steps: entry.steps }] } },
      { id: 'cost', name: 'cost', kind: 'unit', flagship: false, data: { health: 1, attr: '中立' } },
      { id: 'match', name: 'match', kind: 'unit', flagship: false, data: { health: 1, attr } },
    ]
    const snapshot = createOfficialSnapshot({ id: 'hand-cost', rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] })
    const make = (count: number) => {
      const a = createOfficialSeatState([{ id: 'found', cardId: 'match' }])
      a.hand = [{ id: 'source', cardId: entry.cardId }, ...Array.from({ length: count }, (_, i) => ({ id: `cost-${i}`, cardId: 'cost' }))]
      return { seatOrder: ['A', 'B'], seats: { A: a, B: createOfficialSeatState() }, turn: 2,
        finale: null, battleMode: false, effect: null } satisfies OfficialMatchState
    }
    const create = (count: number) => MatchCore.create({ rules: officialRules, snapshot, state: make(count), activeSeat: 'A',
      random: { kind: 'recorded', inputs: [], consumed: 0 } })
    const missing = await create(amount - 1)
    const action = { type: 'play-card' as const, cardId: 'source' }
    const original = missing.read()
    expect(missing.propose({ kind: 'action', seat: 'A', expectedRevision: 0, action })).toMatchObject({ kind: 'rejected', reason: 'hand-cost-unavailable' })
    expect(missing.read()).toBe(original)
    const exact = await create(amount)
    const accepted = exact.propose({ kind: 'action', seat: 'A', expectedRevision: 0, action })
    if (accepted.kind !== 'accepted') throw new Error('expected automatic payment')
    expect(accepted.match.progress.kind).toBe('active')
    expect(accepted.match.state.seats.A.hand.map(card => card.id)).toEqual(['found'])
    expect(accepted.match.state.seats.A.discard.map(card => card.id)).toEqual(['source', ...Array.from({ length: amount }, (_, i) => `cost-${i}`)])
    const extra = await create(amount + 1)
    const waiting = extra.propose({ kind: 'action', seat: 'A', expectedRevision: 0, action })
    if (waiting.kind !== 'accepted' || waiting.match.progress.kind !== 'waiting') throw new Error('expected decision')
    expect(waiting.match.progress.decision.choices).toMatchObject({ min: amount, max: amount, canPass: false, visibility: 'owner' })
    expect(waiting.match.state.seats.A.discard.map(card => card.id)).toEqual(['source'])
    extra.confirm(waiting)
    const response = extra.propose({ kind: 'decision', seat: 'A', expectedRevision: 1, decisionId: waiting.match.progress.decision.id,
      answer: { kind: 'select', candidateIds: Array.from({ length: amount }, (_, i) => `cost-${i}`) } })
    if (response.kind !== 'accepted') throw new Error('expected payment settlement')
    expect(response.match.state.seats.A.hand.map(card => card.id).sort()).toEqual([`cost-${amount}`, 'found'].sort())
  },
)
