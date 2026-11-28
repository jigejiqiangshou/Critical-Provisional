import { expect, it } from 'vitest'
import { MatchCore } from '../../src/match/core'
import { projectOfficialMatch } from '../../src/match/player-interface'
import { initialEffectDefinitions } from '../../src/deck-catalog/effect-definitions'
import { createOfficialSeatState, createOfficialSnapshot, officialRules, OFFICIAL_RULES_VERSION } from '../../src/match/rules'
import type { OfficialMatchState, JsonValue } from '../../src/match/rules'
import type { Card, Release } from '../../src/deck-catalog/catalog'

it.each(['焰羽', '星火', '整备'])('%s chooses within the private top cards and shuffles deterministically', async name => {
  const definition = initialEffectDefinitions.find(entry => entry.legacyName === name)!
  const step = definition.steps[0]
  if (step.type !== 'look-pick') throw new Error('expected look-pick')
  const cards: Card[] = [
    { id: definition.cardId, name, kind: definition.trigger === 'enter' ? 'unit' : 'spell', flagship: false,
      data: { attack: 1, health: 1, effects: [{ trigger: definition.trigger, steps: definition.steps }] } },
    { id: 'unit', name: 'unit', kind: 'unit', flagship: false, data: { health: 1 } },
    { id: 'spell', name: 'spell', kind: 'spell', flagship: false, data: {} },
  ]
  const release: Release = { id: 'look-test', rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] }
  const snapshot = createOfficialSnapshot(release)
  const a = createOfficialSeatState(Array.from({ length: step.top + 1 }, (_, i) => ({
    id: `deck-${i}`, cardId: i === 1 ? 'spell' : 'unit',
  })))
  a.hand = [{ id: 'source', cardId: definition.cardId }]
  const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: createOfficialSeatState() },
    turn: 2, finale: null, battleMode: false, effect: null }
  const setup = () => MatchCore.create({ rules: officialRules, snapshot, state, activeSeat: 'A',
    random: { kind: 'recorded', inputs: Array(20).fill(0), consumed: 0 } })
  const run = async () => {
    const core = await setup()
    const offer = core.propose({ kind: 'action', seat: 'A', expectedRevision: 0,
      action: { type: 'play-card', cardId: 'source' } })
    if (offer.kind !== 'accepted') throw new Error('expected offer')
    const looked = offer.events.find(event => event.type === 'rule-event' && event.name === 'cards-looked')
    expect(looked).toMatchObject({ privateTo: 'A' })
    expect(JSON.stringify(looked)).toContain('deck-1')
    core.confirm(offer)
    const pending = core.read()
    if (pending.progress.kind !== 'waiting') throw new Error('expected choice')
    const choices = pending.progress.decision.choices
    expect(choices.visibility).toBe('owner')
    expect(choices.canPass).toBe(false)
    expect(choices.candidates.map(candidate => candidate.id)).not.toContain(`deck-${step.top}`)
    if (step.kind === 'unit') expect(choices.candidates.map(candidate => candidate.id)).not.toContain('deck-1')
    expect(JSON.stringify(projectOfficialMatch(pending, snapshot, { type: 'spectator' }))).not.toContain('deck-0')
    const selection = core.propose({ kind: 'decision', seat: 'A', expectedRevision: 1,
      decisionId: pending.progress.decision.id, answer: { kind: 'select', candidateIds: ['deck-0'] } })
    if (selection.kind !== 'accepted') throw new Error('expected settlement')
    core.confirm(selection)
    expect(core.read().state.seats.A.hand.map(card => card.id)).toContain('deck-0')
    return { deck: core.read().state.seats.A.deck.map(card => card.id), random: core.read().random }
  }
  expect(await run()).toEqual(await run())
})

it.each(['zero-matches', 'one-viewed'])('%s does not shuffle unseen deck cards or consume randomness', async scenario => {
  const effect = scenario === 'zero-matches'
    ? { type: 'look-pick' as const, top: 2, kind: 'unit' }
    : { type: 'look-pick' as const, top: 1 }
  const cards: Card[] = [
    { id: 'look', name: 'look', kind: 'spell', flagship: false,
      data: { effects: [{ trigger: 'play', steps: [effect as JsonValue] }] } },
    { id: 'spell', name: 'spell', kind: 'spell', flagship: false, data: {} },
  ]
  const snapshot = createOfficialSnapshot({ id: 'look-edge', rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] })
  const a = createOfficialSeatState(['a', 'b', 'c'].map(id => ({ id, cardId: 'spell' })))
  a.hand = [{ id: 'look', cardId: 'look' }]
  const state: OfficialMatchState = { seatOrder: ['A', 'B'], seats: { A: a, B: createOfficialSeatState() },
    turn: 2, finale: null, battleMode: false, effect: null }
  const core = await MatchCore.create({ rules: officialRules, snapshot, state, activeSeat: 'A',
    random: { kind: 'recorded', inputs: [], consumed: 0 } })
  const result = core.propose({ kind: 'action', seat: 'A', expectedRevision: 0,
    action: { type: 'play-card', cardId: 'look' } })
  expect(result.kind).toBe('accepted')
  if (result.kind !== 'accepted') throw new Error('expected automatic settlement')
  expect(result.randomInputs).toEqual([])
  expect(result.match.state.seats.A.deck.map(card => card.id)).toEqual(scenario === 'zero-matches' ? ['a', 'b', 'c'] : ['b', 'c'])
  expect(result.match.state.seats.A.hand.map(card => card.id)).toEqual(scenario === 'zero-matches' ? [] : ['a'])
})
