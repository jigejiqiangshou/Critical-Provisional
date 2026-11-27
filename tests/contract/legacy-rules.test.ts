import { describe, expect, it } from 'vitest'
import fixtures from '../baseline/fixtures.json'
import { MatchCore } from '../../src/match/core'
import type { Card, JsonObject, Release } from '../../src/deck-catalog/catalog'
import { createOfficialPlayerCore, PlayerInterface, toConfirmedMatch } from '../../src/match/player-interface'
import type { CommandConfirmation, OfficialHistory, PlayerCommandStore } from '../../src/match/player-interface'
import { PLAYER_PROTOCOL_V1 } from '../../src/match/player-protocol'
import type { CommandReceipt, CommandRequestSummary, PlayerAction, ServerMessage, ViewScope } from '../../src/match/player-protocol'
import {
  coreTargetId, createOfficialMatch, createOfficialSeatState, createOfficialSnapshot,
  getRuleCapabilities, officialRules, OFFICIAL_RULES_VERSION,
} from '../../src/match/rules'
import type { JsonValue, OfficialCardInstance, OfficialMatchState, OfficialUnit } from '../../src/match/rules'

type Edition = '2d' | '3d'
type Seat = 'A' | 'B'
type LegacyCase = (typeof fixtures.scenarios)[number]
type LegacyCard = { name: string; instanceId: string }
type LegacyUnit = LegacyCard & {
  atk: number; hp: number; maxHp: number; canAttack: boolean; attacked: boolean
  shield: number; skillUsed: boolean; skillLock?: boolean; buffAtk: number
}
type LegacySeat = {
  hp: number; ap: number; ownTurn: number; hasIce: boolean; mulliganUsed: boolean
  hand: readonly LegacyCard[]; deck: readonly LegacyCard[]; grave: readonly LegacyCard[]
  facedown: readonly LegacyCard[]; ice: readonly LegacyCard[]; board: readonly LegacyUnit[]
}
type LegacyState = {
  activeSeat: Seat | null; turn: number; battleMode: boolean; finale: unknown
  winner: string | null; seats: Readonly<Record<Seat, LegacySeat>>
  pending: { owner: Seat; candidates?: readonly LegacyCard[] } | null
}
type LegacyAction = {
  randomValues?: readonly number[]; shuffleDrawOrders?: readonly (readonly string[])[]
}

const sessionId = 'formal-rules-legacy-comparison'
const editions = ['2d', '3d'] as const
const seats = ['A', 'B'] as const

function sample(id: string, variant: string): LegacyCase {
  const scenario = fixtures.scenarios.find(candidate => candidate.id === id && candidate.variant === variant)
  if (!scenario) throw new Error(`Missing baseline scenario ${id} ${variant}`)
  return scenario
}

function initial(scenario: LegacyCase, edition: Edition): LegacyState {
  const value = scenario.initialObserved[edition] as LegacyState | null
  if (!value) throw new Error('Expected a captured confirmed state')
  return value
}

function observed(scenario: LegacyCase, edition: Edition, step = -1): LegacyState {
  const value = scenario.steps.at(step)?.observed[edition].state as LegacyState | null | undefined
  if (!value) throw new Error('Expected a captured settlement state')
  return value
}

function input(scenario: LegacyCase, step: number): LegacyAction {
  const action = scenario.steps[step]?.action
  if (!action) throw new Error('Missing baseline action')
  return action
}

function names(cards: readonly LegacyCard[]) {
  return cards.map(({ name }) => name)
}

function component(cards: readonly LegacyCard[], name: string): string {
  const entry = cards.find(card => card.name === name)
  if (!entry) throw new Error(`Missing ${name} in baseline`)
  return entry.instanceId
}

function commandStore<State, History>() {
  const records = new Map<string, CommandReceipt | CommandRequestSummary>()
  const history: CommandConfirmation<State, History>[] = []
  const key = ({ seatId, commandId }: CommandRequestSummary['key']) => JSON.stringify([seatId, commandId])
  const store: PlayerCommandStore<State, History> = {
    lookup: reference => records.get(key(reference)),
    recordRejection: summary => { records.set(key(summary.key), structuredClone(summary)) },
    confirm(confirmation) {
      history.push(structuredClone(confirmation))
      records.set(key(confirmation.receipt.key), structuredClone(confirmation.receipt))
    },
  }
  return { store, history }
}

async function connect<State, History>(
  player: PlayerInterface<State, History>, name: string, scope: ViewScope,
) {
  const messages: ServerMessage[] = []
  const connection = player.connect(name, { send: message => messages.push(structuredClone(message)), close() {} })
  await connection.receive({ type: 'hello', versions: PLAYER_PROTOCOL_V1 })
  expect(player.authorize(connection, scope)).toBe(true)
  async function view() {
    await connection.receive({ type: 'request', interaction: 'M03', requestId: 'view', sessionId })
    const message = messages.at(-1)
    if (message?.type !== 'response' || message.interaction !== 'M03' || message.result.status !== 'ok') {
      throw new Error('Expected a successful M03 snapshot')
    }
    return message.result.view
  }
  async function submit(commandId: string, action: PlayerAction, basis?: string) {
    const previous = basis ?? (await view()).basis
    const requestId = 'request-' + messages.length
    const seatId = scope.type === 'seat' ? scope.seatId : 'A'
    await connection.receive({
      type: 'request', interaction: 'M02', requestId, sessionId, seatId, commandId, basis: previous, action,
    })
    const reply = messages.find(message =>
      message.type === 'response' && message.interaction === 'M02' && message.requestId === requestId)
    if (reply?.type !== 'response' || reply.interaction !== 'M02') throw new Error('Expected an M02 response')
    return reply.result
  }
  return {
    view, submit, connection, messages,
    events: () => messages.flatMap(message => message.type === 'event' ? [message.event] : []),
  }
}

function select(decisionId: string, ...targetIds: string[]): PlayerAction {
  return { type: 'respond', decisionId, choice: { type: 'select', targetIds } }
}

type LegacyDefinition = {
  type: string; atk?: number; hp?: number; kw?: readonly string[]; evolveFrom?: string | readonly string[]
}
const cardNames = Object.keys(fixtures.cardDefinitions['2d']).sort()
const idsByName = new Map(cardNames.map((name, index) => [name, 'sample-card-' + (index + 1)]))
const namesById = new Map([...idsByName].map(([name, id]) => [id, name]))
const deathSpellCardId = 'fixture-death-spell'

function cardId(name: string) {
  const id = idsByName.get(name)
  if (!id) throw new Error('Missing stable fixture ID for ' + name)
  return id
}

function cardName(id: string) {
  const name = namesById.get(id)
  if (!name) throw new Error('Missing captured name for ' + id)
  return name
}

const registrations: Readonly<Record<string, JsonObject>> = {
  炎纹: { effects: [{ trigger: 'play', steps: [{ type: 'damage-unit', amount: 3, target: 'enemy' }, { type: 'draw', amount: 1 }] }] },
  毕方: { effects: [{ trigger: 'death', steps: [{ type: 'draw', amount: 1 }] }] },
  冰夷: { effects: [{ trigger: 'death', steps: [{ type: 'draw', amount: 1 }] }] },
  火鸦: {
    skill: { id: 'ember', oncePerTurn: true, lock: true },
    effects: [{ trigger: 'skill', steps: [{ type: 'register-death-attack-bonus', amount: 1 }] }],
  },
  探珠: {
    skill: { id: 'pearl' },
    effects: [{ trigger: 'skill', steps: [{ type: 'ice-draw-pick', amount: 3 }] }],
  },
  镇岳: { effects: [{ trigger: 'attack-core', steps: [{ type: 'cancel-attack' }] }] },
}

function release(edition: Edition): Release {
  const definitions: Readonly<Record<string, LegacyDefinition>> = fixtures.cardDefinitions[edition]
  const cards: Card[] = cardNames.map(name => {
    const definition = definitions[name]
    if (!definition) throw new Error('Missing captured card definition ' + name)
    const evolveFrom = definition.evolveFrom
    const kind = definition.type === 'unit' || definition.type === 'trap' || definition.type === 'ace'
      ? definition.type : 'spell'
    return {
      id: cardId(name), name, kind, flagship: kind === 'ace',
      data: {
        ...(definition.atk === undefined ? {} : { attack: definition.atk }),
        ...(definition.hp === undefined ? {} : { health: definition.hp }),
        keywords: definition.kw ?? [],
        ...(evolveFrom ? { evolveFrom: (typeof evolveFrom === 'string' ? [evolveFrom] : evolveFrom).map(cardId) } : {}),
        ...registrations[name],
      },
    }
  })
  cards.push({
    id: deathSpellCardId, name: 'Independent death trigger', kind: 'spell', flagship: false,
    data: { effects: [{ trigger: 'play', steps: [{ type: 'damage-unit', amount: 1, target: 'any' }] }] },
  })
  return { id: 'legacy-fixture-' + edition, rulesVersion: OFFICIAL_RULES_VERSION, cards, presets: [] }
}

function random(inputs: readonly number[]) {
  return { kind: 'recorded', inputs, consumed: 0 } as const
}

/** Convert T002's recorded deck permutation to equivalent Fisher–Yates inputs. */
function shuffleInputs(original: readonly string[], shuffled: readonly string[]) {
  expect(original).toHaveLength(shuffled.length)
  const work = [...original]
  const inputs: number[] = []
  for (let index = work.length - 1; index > 0; index--) {
    const target = shuffled[index]
    const swap = work.slice(0, index + 1).lastIndexOf(target)
    if (swap < 0) throw new Error('Recorded shuffle does not match its source cards')
    inputs.push((swap + 0.5) / (index + 1))
    ;[work[index], work[swap]] = [work[swap], work[index]]
  }
  expect(work).toEqual(shuffled)
  return inputs
}

function sameDrawOrder(deck: readonly string[]) {
  return shuffleInputs(deck, deck)
}

function instance(source: LegacyCard): OfficialCardInstance {
  return { id: source.instanceId, cardId: cardId(source.name) }
}

function unit(source: LegacyUnit): OfficialUnit {
  return {
    ...instance(source), hp: source.hp, canAttack: source.canAttack, attacked: source.attacked,
    skillUsed: source.skillUsed, skillLock: source.skillLock ?? false,
    attackBonus: source.buffAtk, deathAttackBonus: 0, stealth: false, stunned: false, shield: source.shield,
  }
}

function fixtureState(source: LegacyState): OfficialMatchState {
  const loadSeat = ({ hp, ap, ownTurn, hasIce, mulliganUsed, deck, hand, board, grave, facedown, ice }: LegacySeat) => ({
    ...createOfficialSeatState(deck.map(instance), hasIce),
    hp, ap, ownTurn, mulliganUsed, hand: hand.map(instance), board: board.map(unit),
    discard: grave.map(instance), facedown: facedown.map(instance), ice: ice.map(instance),
  })
  return {
    seatOrder: seats, seats: { A: loadSeat(source.seats.A), B: loadSeat(source.seats.B) },
    turn: source.turn, finale: null, battleMode: source.battleMode, effect: null,
  }
}

async function coreFor(scenario: LegacyCase, edition: Edition, inputs: readonly number[] = []) {
  const source = initial(scenario, edition)
  if (!source.activeSeat) throw new Error('Expected an active legacy seat')
  const snapshot = createOfficialSnapshot(release(edition))
  return MatchCore.create({
    rules: officialRules, snapshot, state: fixtureState(source), activeSeat: source.activeSeat, random: random(inputs),
  })
}

type OfficialCore = Awaited<ReturnType<typeof coreFor>>
type MatchSnapshot = ReturnType<OfficialCore['read']>

async function peers(core: OfficialCore, persistence = commandStore<MatchSnapshot, OfficialHistory>()) {
  const player = new PlayerInterface({
    sessionId, confirmed: toConfirmedMatch(core.read()), core: createOfficialPlayerCore(core), store: persistence.store,
  })
  return {
    A: await connect(player, 'A', { type: 'seat', seatId: 'A' }),
    B: await connect(player, 'B', { type: 'seat', seatId: 'B' }),
    observer: await connect(player, 'observer', { type: 'spectator' }),
    persistence,
  }
}

function compare(core: OfficialCore, reference: LegacyState) {
  const current = core.read()
  const state = current.state
  expect(state.turn).toBe(reference.turn)
  expect(Boolean(state.finale)).toBe(Boolean(reference.finale))
  if (reference.winner) {
    expect(current.progress).toMatchObject({ kind: 'ended', outcome: { winner: reference.winner } })
  } else {
    expect(current.progress.kind).not.toBe('ended')
  }
  if (!reference.pending && reference.activeSeat && !reference.winner) {
    expect(current.progress).toMatchObject({ kind: 'active', activeSeat: reference.activeSeat })
  }
  for (const seat of seats) {
    const actual = state.seats[seat]
    const expected = reference.seats[seat]
    expect({ hp: actual.hp, ap: actual.ap }).toEqual({ hp: expected.hp, ap: expected.ap })
    for (const [left, right] of [
      [actual.hand, expected.hand], [actual.deck, expected.deck], [actual.facedown, expected.facedown],
      [actual.discard, expected.grave], [actual.ice, expected.ice],
    ] as const) {
      expect(left.map(({ cardId }) => cardName(cardId))).toEqual(names(right))
    }
    expect(actual.board.map(({ cardId, hp, attacked, canAttack }) => ({ name: cardName(cardId), hp, attacked, canAttack })))
      .toEqual(expected.board.map(({ name, hp, attacked, canAttack }) => ({ name, hp, attacked, canAttack })))
  }
}

function waiting(core: OfficialCore) {
  const { progress } = core.read()
  if (progress.kind !== 'waiting') throw new Error('Expected a confirmed pending decision')
  return progress.decision
}

function expectAccepted(reply: Awaited<ReturnType<Awaited<ReturnType<typeof connect>>['submit']>>) {
  expect(reply).toMatchObject({ status: 'accepted' })
}

async function rejectedWithoutChange(
  core: OfficialCore, clients: Awaited<ReturnType<typeof peers>>, seat: Seat, id: string, action: PlayerAction,
) {
  const before = core.read()
  const events = [clients.A, clients.B, clients.observer].map(client => client.events().length)
  expect(await clients[seat].submit(id, action)).toMatchObject({ status: 'rejected', reason: expect.any(String) })
  expect(core.read()).toBe(before)
  expect([clients.A, clients.B, clients.observer].map(client => client.events().length)).toEqual(events)
}

describe.each(editions)('migration rules against legacy %s', edition => {
  it.each(['mulligan', 'out-of-window'])('LG-01 opens with the original decks and applies the %s guard', async variant => {
    const record = sample('LG-01', variant)
    const order = input(record, 0).shuffleDrawOrders
    if (!order || order.length !== 2) throw new Error('Missing captured opening decks')
    const open = observed(record, edition, 0)
    const replacement = input(record, 1).shuffleDrawOrders?.[0]
    const oldHand = names(open.seats.A.hand)
    const oldDeck = names(open.seats.A.deck)
    const matchInputs = [...sameDrawOrder(order[0]), ...sameDrawOrder(order[1])]
    if (replacement) matchInputs.push(...shuffleInputs([...oldHand, ...oldDeck], replacement))
    const core = await createOfficialMatch({
      snapshot: createOfficialSnapshot(release(edition)),
      seats: [{ seatId: 'A', deck: order[0].map(cardId) }, { seatId: 'B', deck: order[1].map(cardId) }],
      random: random(matchInputs),
    })
    compare(core, open)
    expect(core.read().state.seats.A.hand).toHaveLength(4)
    expect(core.read().state.seats.B.hand).toHaveLength(4)
    expect(core.read().state.seats.A.ap).toBe(0)
    const clients = await peers(core)
    const mulligan = () => ({ type: 'mulligan', cardIds: core.read().state.seats.A.hand.map(({ id }) => id) }) as const
    if (replacement) {
      expectAccepted(await clients.A.submit('mulligan', mulligan()))
      compare(core, observed(record, edition, 1))
      await rejectedWithoutChange(core, clients, 'A', 'duplicate', mulligan())
    } else {
      expectAccepted(await clients.A.submit('close-opening-window', { type: 'end-turn' }))
      compare(core, observed(record, edition, 1))
      await rejectedWithoutChange(core, clients, 'A', 'late', mulligan())
    }
    const owner = (await clients.A.view()).snapshot
    expect(JSON.stringify(owner)).toContain(core.read().state.seats.A.hand[0].id)
    for (const client of [clients.B, clients.observer]) {
      const others = (await client.view()).snapshot
      expect(JSON.stringify(others)).not.toContain(core.read().state.seats.A.hand[0].id)
    }
  })

  it.each(['main', 'battle-mode'])('LG-02 plays Flame Mark with a unit target in %s', async variant => {
    const record = sample('LG-02', variant)
    const source = initial(record, edition)
    const core = await coreFor(record, edition)
    const clients = await peers(core)
    const play = {
      type: 'play-card', cardId: component(source.seats.A.hand, '炎纹'),
      targets: [component(source.seats.B.board, '火鸦')],
    } as const
    if (variant === 'battle-mode') {
      await rejectedWithoutChange(core, clients, 'A', 'locked-spell', play)
    } else {
      expectAccepted(await clients.A.submit('damage-then-draw', play))
      const history = clients.persistence.history
      expect(history).toHaveLength(1)
      const result = history[0].history?.events
        .flatMap(event => event.type === 'rule-event' ? [event.name] : [])
        .filter(name => ['unit-damaged', 'unit-destroyed', 'draw'].includes(name))
      expect(result).toEqual(['unit-damaged', 'unit-destroyed', 'draw'])
      const drawnInstanceId = core.read().state.seats.A.hand[0].id
      expect(JSON.stringify(clients.A.events())).toContain(drawnInstanceId)
      for (const client of [clients.B, clients.observer]) {
        expect(JSON.stringify(client.events())).not.toContain(drawnInstanceId)
      }
    }
    compare(core, observed(record, edition))
    expect(core.read().random.consumed).toBe(0)
  })

  it('LG-03 rejects a protected core and applies unit damage only once', async () => {
    const record = sample('LG-03', 'attack')
    const source = initial(record, edition)
    const attackerId = component(source.seats.A.board, '火鸦')
    const victimId = component(source.seats.B.board, '冰夷')
    const core = await coreFor(record, edition)
    const clients = await peers(core)
    await rejectedWithoutChange(core, clients, 'A', 'protected-core', {
      type: 'attack', attackerId, targetId: coreTargetId('B'),
    })
    const hit = { type: 'attack', attackerId, targetId: victimId } as const
    expectAccepted(await clients.A.submit('hit-unit', hit))
    compare(core, observed(record, edition, 2))
    await rejectedWithoutChange(core, clients, 'A', 'repeat', hit)
    compare(core, observed(record, edition))
    expect(core.read().random.consumed).toBe(0)
  })

  it('LG-04 rejects the wrong evolution and keeps the matched board slot', async () => {
    const record = sample('LG-04', 'evolve')
    const source = initial(record, edition)
    const cardId = component(source.seats.A.hand, '三足金乌')
    const core = await coreFor(record, edition)
    const clients = await peers(core)
    await rejectedWithoutChange(core, clients, 'A', 'wrong-base', {
      type: 'evolve', cardId, targets: [component(source.seats.A.board, '毕方')],
    })
    expectAccepted(await clients.A.submit('evolve', {
      type: 'evolve', cardId, targets: [component(source.seats.A.board, '火鸦')],
    }))
    compare(core, observed(record, edition))
  })

  it.each(['same-turn', 'after-turn'])('LG-05 settles a death through the rules while checking Ember %s', async variant => {
    const record = sample('LG-05', variant)
    const source = initial(record, edition)
    const snapshot = createOfficialSnapshot(release(edition))
    const sourceId = component(source.seats.A.board, '火鸦')
    const targetId = component(source.seats.A.board, '毕方')
    const caster = variant === 'same-turn' ? 'A' : 'B'
    const state = fixtureState(source)
    const deathSpell = { id: 'fixture-death-instance', cardId: deathSpellCardId }
    const core = await MatchCore.create({
      rules: officialRules, snapshot, random: random([]), activeSeat: 'A',
      state: { ...state, seats: { ...state.seats, [caster]: {
        ...state.seats[caster], hand: [...state.seats[caster].hand, deathSpell],
      } } },
    })
    const clients = await peers(core)
    const skill = { type: 'activate-skill', sourceId, skillId: 'ember' } as const
    expectAccepted(await clients.A.submit('enable-death-bonus', skill))
    expect(core.read().state.seats.A.board[0]).toMatchObject({ skillLock: true, skillUsed: true })
    await rejectedWithoutChange(core, clients, 'A', 'repeat-skill', skill)
    await rejectedWithoutChange(core, clients, 'A', 'locked-attack', {
      type: 'attack', attackerId: sourceId, targetId: coreTargetId('B'),
    })
    if (caster === 'B') expectAccepted(await clients.A.submit('finish-skill-turn', { type: 'end-turn' }))
    expectAccepted(await clients[caster].submit('kill-bifang', {
      type: 'play-card', cardId: deathSpell.id, targets: [targetId],
    }))
    const expected = observed(record, edition).seats.A
    const actual = core.read().state.seats.A
    expect(actual.hand.map(card => cardName(card.cardId))).toEqual(names(expected.hand))
    expect(actual.discard.filter(card => card.id !== deathSpell.id).map(card => cardName(card.cardId))).toEqual(names(expected.grave))
    expect(actual.board).toHaveLength(1)
    expect(actual.board[0].attackBonus).toBe(expected.board[0].buffAtk)
    expect(core.read().random.consumed).toBe(0)
  })

  it.each(['flip', 'decline', 'invalid'])('LG-06 opens the authorized response and resolves %s', async variant => {
    const record = sample('LG-06', variant)
    const source = initial(record, edition)
    const trap = component(source.seats.A.facedown, '镇岳')
    const core = await coreFor(record, edition)
    const clients = await peers(core)
    expectAccepted(await clients.B.submit('attack', {
      type: 'attack', attackerId: component(source.seats.B.board, '火鸦'), targetId: coreTargetId('A'),
    }))
    const decision = waiting(core)
    expect(decision).toMatchObject({ owner: 'A', choices: { canPass: true, candidates: [{ id: trap }] } })
    const paused = core.read()
    expect(paused.state.seats.A.hp).toBe(50)
    expect(paused.state.seats.B.ap).toBe(1)
    expect(paused.state.seats.B.board[0].attacked).toBe(false)
    expect(JSON.stringify((await clients.A.view()).snapshot)).toContain(trap)
    for (const client of [clients.B, clients.observer]) {
      expect(JSON.stringify((await client.view()).snapshot)).not.toContain(trap)
      expect(JSON.stringify(client.events())).not.toContain(trap)
    }
    if (variant === 'invalid') {
      await rejectedWithoutChange(core, clients, 'A', 'invalid-response', select(decision.id, 'out-of-range'))
      expect(core.read()).toBe(paused)
      expectAccepted(await clients.A.submit('following-valid-response', select(decision.id, trap)))
      compare(core, observed(sample('LG-06', 'flip'), edition))
    } else {
      const response = variant === 'flip' ? select(decision.id, trap) : {
        type: 'respond', decisionId: decision.id, choice: { type: 'pass' },
      } as const
      expectAccepted(await clients.A.submit('response', response))
      compare(core, observed(record, edition))
    }
    expect(core.read().random.consumed).toBe(0)
  })

  it.each(['threshold', 'below-threshold'])('LG-07 starts the next turn after evaluating %s', async variant => {
    const record = sample('LG-07', variant)
    const source = initial(record, edition)
    const draws = input(record, 0).shuffleDrawOrders
    const below = variant === 'below-threshold'
    const randomInputs = draws?.flatMap((target, index) => {
      const seat = source.seats[seats[index]]
      return shuffleInputs([...names(seat.deck), ...names(seat.hand).slice(0, 7)], target)
    }) ?? []
    const core = await coreFor(record, edition, randomInputs)
    const clients = await peers(core)
    expectAccepted(await clients.A.submit('end-and-advance-turn', { type: 'end-turn' }))
    compare(core, observed(record, edition, 1))
    expect(core.read().state.seats.A.discard.length + core.read().state.seats.B.discard.length)
      .toBe(below ? 39 : 40)
    if (!below) {
      expect(core.read().state.seats.A.hand).toHaveLength(6)
      expect(core.read().state.seats.B.hand).toHaveLength(8)
      const timeline = clients.persistence.history[0].history
      expect(timeline).toMatchObject({
        events: [
          { name: 'hand-limit-discard' }, { name: 'finale-started' },
          { name: 'draw', data: { seat: 'A', cardIds: expect.any(Array) } },
          { name: 'draw', data: { seat: 'B', cardIds: expect.any(Array) } },
          { name: 'turn-started' }, { name: 'draw', data: { seat: 'B', cardIds: expect.any(Array) } },
        ],
      })
      const batchSizes = timeline?.events.flatMap(event => {
        if (event.type !== 'rule-event' || event.name !== 'draw') return []
        const data = event.data as { cardIds: readonly string[] }
        return [data.cardIds.length]
      })
      expect(batchSizes).toEqual([6, 7, 1])
      const battling = core.read()
      expectAccepted(await clients.B.submit('finale-strike', {
        type: 'attack', attackerId: component(source.seats.B.board, '火鸦'), targetId: coreTargetId('A'),
      }))
      expect(core.read().state.seats.B.ap).toBe(battling.state.seats.B.ap)
      compare(core, observed(record, edition))
    }
  })

  it.each(['playable', 'unplayable', 'restart', 'empty', 'one-playable', 'one-unplayable', 'two'])(
    'LG-08 resolves the captured %s spring and preserves the original candidate order internally', async variant => {
      const record = sample('LG-08', variant)
      const source = initial(record, edition)
      const samples = input(record, 0).randomValues ?? []
      const core = await coreFor(record, edition, samples)
      let clients = await peers(core)
      let activeCore = core
      const skill = { type: 'activate-skill', sourceId: component(source.seats.A.board, '探珠'), skillId: 'pearl' } as const
      const before = (await clients.A.view()).basis
      const receipt = await clients.A.submit('sample-the-spring', skill, before)
      expectAccepted(receipt)
      expect(await clients.A.submit('sample-the-spring', skill, before)).toEqual(receipt)
      expect(core.read().random.consumed).toBe(samples.length)
      expect(clients.persistence.history).toHaveLength(1)
      const pausedLegacy = observed(record, edition, 0).pending
      const automatic = variant === 'empty' || variant.startsWith('one-')
      if (automatic) {
        expect(core.read().progress.kind).toBe('active')
      } else {
        const decision = waiting(core)
        expect(decision.owner).toBe('A')
        const namedCandidates = decision.choices.candidates.map(candidate => {
          const card = source.seats.A.ice.find(card => card.instanceId === candidate.id)
          if (!card) throw new Error('Unknown sampled ice card')
          return card.name
        })
        expect(namedCandidates).toEqual(names(pausedLegacy?.candidates ?? []))
        if (variant === 'restart') {
          const persisted = structuredClone(clients.persistence.history[0].next.state)
          activeCore = await MatchCore.restore({ rules: officialRules, snapshot: createOfficialSnapshot(release(edition)), match: persisted })
          clients = await peers(activeCore, clients.persistence)
          expect(waiting(activeCore)).toEqual(decision)
          expect(await clients.A.submit('sample-the-spring', skill, before)).toEqual(receipt)
        }
        const selected = variant === 'unplayable' ? decision.choices.candidates[1] : decision.choices.candidates[0]
        expectAccepted(await clients.A.submit('use-sampled-card', select(decision.id, selected.id)))
        expect(activeCore.read().random.consumed).toBe(samples.length)
      }
      const expected = variant === 'restart' ? sample('LG-08', 'playable') : record
      compare(activeCore, observed(expected, edition))
    },
  )

  it('LG-09 confirms surrender through M02 and closes every authorized connection', async () => {
    const record = sample('LG-09', 'surrender')
    const core = await coreFor(record, edition)
    const clients = await peers(core)
    const oldBasis = (await clients.A.view()).basis
    expectAccepted(await clients.A.submit('surrender', { type: 'concede' }, oldBasis))
    compare(core, observed(record, edition))
    const [confirmation] = clients.persistence.history
    expect(confirmation).toMatchObject({
      action: { type: 'concede' }, next: { terminal: true, outcome: { winner: 'B', reason: 'conceded' } },
    })
    expect(core.read().random.consumed).toBe(0)
    expect(clients.persistence.history).toHaveLength(1)
    for (const client of [clients.A, clients.B, clients.observer]) {
      expect(client.connection.capability).toBeUndefined()
      expect(client.events()).toContainEqual(expect.objectContaining({ type: 'terminal' }))
    }
  })
})

describe('D04 locked rules capabilities', () => {
  it('returns a version-specific, read-only list of implemented triggers and effects', () => {
    expect(getRuleCapabilities('unsupported-fixture-version')).toBeUndefined()
    const capabilities = getRuleCapabilities(OFFICIAL_RULES_VERSION)
    expect(capabilities).toMatchObject({
      triggers: expect.arrayContaining(['play', 'enter', 'death', 'skill', 'attack-core', 'attack-unit']),
      effects: expect.arrayContaining([
        'damage-unit', 'draw', 'register-death-attack-bonus', 'ice-draw-pick', 'cancel-attack',
      ]),
    })
    if (!capabilities) throw new Error('Current rules version has no D04 capabilities')
    expect(Object.isFrozen(capabilities)).toBe(true)
    expect(Object.isFrozen(capabilities.triggers)).toBe(true)
    expect(Object.isFrozen(capabilities.effects)).toBe(true)
    expect(capabilities.effects).not.toContain('unsupported-fixture-effect')
  })
})
