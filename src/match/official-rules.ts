import { MatchCore } from './core'
import type { RandomState } from './core'
import { createEffectRuntime } from './effects'
import type { EffectContinuation, EffectDecisionEvent, EffectProgram } from './effects'
import {
  coreTargetId, createOfficialSeatState, officialCard, officialCardData, OFFICIAL_RULES_VERSION, opposingSeat,
} from './official-state'
import type {
  ChoiceFrame, OfficialCardInstance, OfficialEffect, OfficialMatchState, OfficialSeatSetup,
  OfficialSeatState, OfficialTrigger, OfficialUnit, RuleTask,
} from './official-state'
import type { PlayerAction } from './player-protocol'
import type { CardPoolSnapshot, JsonValue, MatchOutcome, RuleContext, RuleResolution, Ruleset, SeatId } from './rules'
import rulesSource from './official-rules.ts?raw'
import stateSource from './official-state.ts?raw'
import effectSource from './effects.ts?raw'
import coreSource from './core.ts?raw'

interface VisibleRuleEvent {
  readonly type: 'rule-event'
  readonly privateTo: SeatId | null
  readonly name: string
  readonly data: JsonValue
}

export type OfficialRuleEvent = VisibleRuleEvent | EffectDecisionEvent
export type OfficialCore = MatchCore<OfficialMatchState, PlayerAction, EffectContinuation, OfficialRuleEvent>

type OfficialResolution = RuleResolution<OfficialMatchState, EffectContinuation, OfficialRuleEvent>

const capabilities = Object.freeze({
  triggers: Object.freeze(['play', 'enter', 'death', 'skill', 'attack-core', 'attack-unit'] as const satisfies readonly OfficialTrigger[]),
  effects: Object.freeze([
    'damage-unit', 'draw', 'register-death-attack-bonus', 'ice-draw-pick', 'cancel-attack',
    'heal-core', 'shield-core', 'destroy-unit', 'bonus-core-attack', 'damage-all-enemies', 'pre-strike', 'shield-unit', 'shield-all-own', 'buff-unit', 'lock-field', 'lock-own-attacks', 'discard-hand', 'look-pick', 'search-deck', 'hand-cost', 'pay-life',
  ] as const satisfies readonly OfficialEffect['type'][]),
})

/** D04. Capabilities are read-only and tied to the executable rules version. */
export function getRuleCapabilities(version: string) {
  return version === OFFICIAL_RULES_VERSION ? capabilities : undefined
}

function visible(name: string, data: JsonValue, privateTo: SeatId | null = null): VisibleRuleEvent {
  return { type: 'rule-event', name, data, privateTo }
}

function shuffle<T>(items: T[], random: () => number): void {
  for (let index = items.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1))
    const item = items[index]
    items[index] = items[other]
    items[other] = item
  }
}

function draw(state: OfficialMatchState, seat: SeatId, amount: number, events: VisibleRuleEvent[]): void {
  const player = state.seats[seat]
  const ids: string[] = []
  for (let i = 0; i < amount; i++) {
    const card = player.deck.shift()
    if (card) {
      player.hand.push(card)
      ids.push(card.id)
    } else {
      player.fatigue++
      player.hp -= player.fatigue
      events.push(visible('fatigue', { seat, amount: player.fatigue, hp: player.hp }))
    }
  }
  if (ids.length) events.push(visible('draw', { seat, cardIds: ids }, seat))
}

function outcome(state: Readonly<OfficialMatchState>): MatchOutcome | undefined {
  const [first, second] = state.seatOrder
  const firstLost = state.seats[first].hp <= 0
  const secondLost = state.seats[second].hp <= 0
  if (!firstLost && !secondLost) return
  return { winner: firstLost ? (secondLost ? null : second) : first, reason: 'core-depleted' }
}

function active(
  state: OfficialMatchState, activeSeat: SeatId, events: readonly OfficialRuleEvent[] = [],
): OfficialResolution {
  const result = outcome(state)
  return result ? { kind: 'ended', state, events, outcome: result } : { kind: 'active', state, events, activeSeat }
}

function hasKeyword(snapshot: CardPoolSnapshot, card: OfficialCardInstance, english: string, legacy: string): boolean {
  const keywords = officialCardData(officialCard(snapshot, card.cardId)).keywords
  return keywords?.includes(english) === true || keywords?.includes(legacy) === true
}

function newUnit(snapshot: CardPoolSnapshot, card: OfficialCardInstance): OfficialUnit {
  const data = officialCardData(officialCard(snapshot, card.cardId))
  if (!Number.isSafeInteger(data.health) || data.health! <= 0) throw new TypeError('Unit health is required: ' + card.cardId)
  return {
    ...card, hp: data.health!, canAttack: hasKeyword(snapshot, card, 'rush', '突袭'), attacked: false,
    skillUsed: false, skillLock: false, attackBonus: 0, deathAttackBonus: 0,
    stealth: hasKeyword(snapshot, card, 'stealth', '隐匿'), stunned: false, shield: data.shield ?? 0,
  }
}

function startTurn(
  state: OfficialMatchState, snapshot: CardPoolSnapshot, seat: SeatId, events: VisibleRuleEvent[],
): void {
  const player = state.seats[seat]
  state.turn++
  player.ownTurn++
  player.ap = player.ownTurn <= 3 ? 0 : player.ownTurn <= 5 ? 1 : 2
  player.board.forEach(unit => {
    unit.canAttack = true
    unit.skillLock = false
    unit.deathAttackBonus = 0
    if (hasKeyword(snapshot, unit, 'shield', '护盾')) {
      unit.shield = officialCardData(officialCard(snapshot, unit.cardId)).shield ?? 0
    }
  })
  events.push(visible('turn-started', { seat, turn: state.turn, ap: player.ap }))
  draw(state, seat, 1, events)
}

export function createOfficialMatch(input: {
  readonly snapshot: CardPoolSnapshot
  readonly seats: readonly [OfficialSeatSetup, OfficialSeatSetup]
  readonly random: RandomState
}): Promise<OfficialCore> {
  const { snapshot, seats, random } = input
  const seatOrder = [seats[0].seatId, seats[1].seatId] as const
  if (!seatOrder[0] || !seatOrder[1] || seatOrder[0] === seatOrder[1]) {
    throw new TypeError('Two distinct seats are required')
  }
  return MatchCore.create({
    rules: officialRules, snapshot, random, activeSeat: seatOrder[0],
    initialize(nextRandom, lockedSnapshot): OfficialMatchState {
      const state: OfficialMatchState = {
        seatOrder,
        seats: Object.fromEntries(seats.map(({ seatId, deck, iceEnabled }) => {
          const cards = deck.map((cardId, index) => {
            officialCard(lockedSnapshot, cardId)
            return { id: seatId + ':card:' + (index + 1), cardId }
          })
          shuffle(cards, nextRandom)
          return [seatId, createOfficialSeatState(cards, iceEnabled)]
        })),
        battleMode: false,
        effect: null,
        finale: null,
        turn: 0,
      }
      draw(state, seatOrder[0], 3, [])
      draw(state, seatOrder[1], 4, [])
      startTurn(state, lockedSnapshot, seatOrder[0], [])
      return state
    },
  })
}

function unitLocation(state: Readonly<OfficialMatchState>, id: string) {
  for (const seat of state.seatOrder) {
    const index = state.seats[seat].board.findIndex(unit => unit.id === id)
    if (index >= 0) return { seat, index, unit: state.seats[seat].board[index] }
  }
}

function effectsFor(snapshot: CardPoolSnapshot, card: OfficialCardInstance, trigger: OfficialTrigger) {
  const registrations = officialCardData(officialCard(snapshot, card.cardId)).effects
  return registrations?.filter(item => item.trigger === trigger).flatMap(item => item.steps) ?? []
}

function effectTasks(
  snapshot: CardPoolSnapshot, seat: SeatId, card: OfficialCardInstance, trigger: OfficialTrigger, targetId: string | null,
): RuleTask[] {
  const registrations = officialCardData(officialCard(snapshot, card.cardId)).effects ?? []
  return registrations.filter(item => item.trigger === trigger).flatMap(item => item.steps.map(effect => ({
    type: 'effect' as const, seat, sourceId: card.id, targetId, effect, timing: item.timing ?? 'immediate',
  })))
}

function frame(state: OfficialMatchState) {
  if (!state.effect) throw new TypeError('No effect to settle')
  return state.effect
}

function selection(state: OfficialMatchState): ChoiceFrame {
  const choice = frame(state).choice
  if (!choice) throw new TypeError('No effect choice to settle')
  return choice
}

function destroyUnit(
  state: OfficialMatchState, snapshot: CardPoolSnapshot, targetId: string, events: VisibleRuleEvent[],
): void {
  const found = unitLocation(state, targetId)
  if (!found) return
  const { seat, index, unit } = found
  const player = state.seats[seat]
  player.board.splice(index, 1)
  const card = { id: unit.id, cardId: unit.cardId }
  player.discard.push(card)
  events.push(visible('unit-destroyed', { seat, card }))
  const deathTasks = effectTasks(snapshot, seat, card, 'death', null)
  const immediate = deathTasks.filter(task => task.type !== 'effect' || task.timing !== 'after-action')
  const deferred = deathTasks.filter(task => task.type === 'effect' && task.timing === 'after-action')
  frame(state).queue.unshift(...immediate, { type: 'death-bonuses', seat })
  frame(state).deferredDeath.push(...deferred)
}

function damageUnit(
  state: OfficialMatchState, snapshot: CardPoolSnapshot, targetId: string,
  amount: number, pierce: boolean, events: VisibleRuleEvent[],
): void {
  const found = unitLocation(state, targetId)
  if (!found) return
  const { seat, unit } = found
  const absorbed = pierce ? 0 : Math.min(unit.shield, amount)
  unit.shield -= absorbed
  unit.hp -= amount - absorbed
  events.push(visible('unit-damaged', { seat, targetId, amount: amount - absorbed, hp: unit.hp }))
  if (unit.hp <= 0) destroyUnit(state, snapshot, targetId, events)
}

function damageCore(state: OfficialMatchState, seat: SeatId, amount: number, events: VisibleRuleEvent[], pierce = false): void {
  const player = state.seats[seat]
  const buffered = Math.min(player.temporaryHealth, amount)
  const shielded = pierce ? 0 : Math.min(player.coreShield, amount - buffered)
  player.temporaryHealth -= buffered
  player.coreShield -= shielded
  player.hp -= amount - buffered - shielded
  events.push(visible('core-damaged', { seat, amount: amount - buffered - shielded, hp: player.hp }))
}

function finishAttack(
  state: OfficialMatchState, snapshot: CardPoolSnapshot, task: Extract<RuleTask, { type: 'attack' }>,
  events: VisibleRuleEvent[],
): void {
  const { seat, attackerId, targetId } = task
  const player = state.seats[seat]
  const attacker = player.board.find(unit => unit.id === attackerId)
  if (!attacker) return
  if (!state.finale) player.ap--
  attacker.attacked = true
  attacker.stealth = false
  const cancelled = frame(state).cancelAttack
  events.push(visible('attack', { seat, attackerId, targetId, cancelled }))
  if (cancelled) return
  const power = officialCardData(officialCard(snapshot, attacker.cardId)).attack ?? 0
  const bonus = targetId === coreTargetId(opposingSeat(state, seat))
    ? effectsFor(snapshot, attacker, 'attack-core').reduce((total, effect) =>
      total + (effect.type === 'bonus-core-attack' ? effect.amount : 0), 0)
    : 0
  const amount = Math.max(0, power + attacker.attackBonus + bonus)
  const opponent = opposingSeat(state, seat)
  if (targetId === coreTargetId(opponent)) {
    for (const effect of effectsFor(snapshot, attacker, 'attack-core')) {
      if (effect.type === 'pre-strike') damageCore(state, opponent, effect.amount, events, true)
    }
    if (state.seats[opponent].hp > 0) damageCore(state, opponent, amount, events)
  } else {
    for (const effect of effectsFor(snapshot, attacker, 'attack-unit')) {
      if (effect.type === 'pre-strike') damageUnit(state, snapshot, targetId, effect.amount, true, events)
    }
    damageUnit(state, snapshot, targetId, amount, hasKeyword(snapshot, attacker, 'pierce', '穿透'), events)
  }
  /* Unit removal by pre-strike makes the regular hit a no-op. */
}

function executeEffect(
  state: OfficialMatchState, snapshot: CardPoolSnapshot, random: () => number,
  task: Extract<RuleTask, { type: 'effect' }>, events: VisibleRuleEvent[],
): void {
  const { seat, sourceId, targetId, effect } = task
  const player = state.seats[seat]
  switch (effect.type) {
    case 'damage-unit':
      if (targetId !== null) damageUnit(state, snapshot, targetId, effect.amount, effect.pierce === true, events)
      break
    case 'damage-all-enemies': {
      const targets = state.seats[opposingSeat(state, seat)].board.map(unit => unit.id)
      frame(state).queue.unshift(...targets.map(target => ({
        type: 'effect' as const, seat, sourceId, targetId: target,
        effect: { type: 'damage-unit' as const, amount: effect.amount, target: 'enemy' as const, pierce: effect.pierce },
      })))
      break
    }
    case 'search-deck': {
      const cards = player.deck.filter(card => {
        const candidate = officialCard(snapshot, card.cardId)
        const data = officialCardData(candidate)
        return candidate.kind !== 'ace' && (!effect.kind || candidate.kind === effect.kind) &&
          (!effect.attr || data.attr === effect.attr) && (!effect.names || effect.names.includes(candidate.name)) &&
          (effect.evoStage === undefined || data.evoStage === effect.evoStage) &&
          (effect.evoStageMin === undefined || (data.evoStage ?? -1) >= effect.evoStageMin) &&
          (effect.attackMin === undefined || (candidate.kind === 'unit' && (data.attack ?? -1) >= effect.attackMin)) &&
          (effect.healthMin === undefined || (candidate.kind === 'unit' && (data.health ?? -1) >= effect.healthMin)) &&
          (!effect.keyword || data.keywords?.includes(effect.keyword))
      })
      frame(state).choice = { kind: 'search-deck', seat, cards, amount: effect.amount }
      break
    }
    case 'look-pick': {
      const viewed = player.deck.slice(0, effect.top)
      const candidates = viewed.filter(card => {
        const data = officialCard(snapshot, card.cardId)
        return data.kind !== 'ace' && (!effect.kind || data.kind === effect.kind) && (!effect.attr || officialCardData(data).attr === effect.attr)
      })
      events.push(visible('cards-looked', { seat, cards: viewed.map(card => ({ id: card.id, cardId: card.cardId })) }, seat))
      frame(state).choice = { kind: 'look-pick', seat, cards: candidates, viewedCount: viewed.length }
      break
    }
    case 'pay-life': {
      const amount = effect.amount === 'half' ? Math.min(player.hp - 1, Math.max(1, Math.floor(player.hp / 2))) : effect.amount
      if (amount < 0 || player.hp <= amount) throw new TypeError('Life cost is not payable')
      player.hp -= amount
      events.push(visible('life-paid', { seat, amount, hp: player.hp }))
      break
    }
    case 'hand-cost':
      frame(state).choice = { kind: 'hand-cost', seat, sourceId, cards: [...player.hand], amount: effect.amount,
        canPass: effect.canPass, onSelect: effect.onSelect }
      break
    case 'discard-hand':
      frame(state).choice = { kind: 'discard-hand', seat, cards: [...player.hand], amount: effect.amount }
      break
    case 'lock-field':
      player.fieldLock = effect.attr
      events.push(visible('field-locked', { seat, attr: effect.attr }))
      break
    case 'lock-own-attacks':
      player.selfAttackLock = true
      events.push(visible('own-attacks-locked', { seat }))
      break
    case 'buff-unit': {
      const target = targetId === null ? undefined : unitLocation(state, targetId)
      if (target) {
        target.unit.attackBonus += effect.attack
        target.unit.hp += effect.health
        if (effect.rush) target.unit.canAttack = true
        events.push(visible('unit-buffed', { seat: target.seat, targetId, attack: effect.attack, health: effect.health, rush: effect.rush === true }))
      }
      break
    }
    case 'shield-unit': {
      const target = targetId === null ? undefined : unitLocation(state, targetId)
      if (target) {
        target.unit.shield += effect.amount
        events.push(visible('unit-shielded', { seat: target.seat, targetId, amount: effect.amount, shield: target.unit.shield }))
      }
      break
    }
    case 'shield-all-own':
      for (const unit of player.board) {
        if (effect.excludeSource && unit.id === sourceId) continue
        unit.shield += effect.amount
        events.push(visible('unit-shielded', { seat, targetId: unit.id, amount: effect.amount, shield: unit.shield }))
      }
      break
    case 'destroy-unit':
      if (targetId !== null) destroyUnit(state, snapshot, targetId, events)
      break
    case 'draw':
      draw(state, seat, effect.amount, events)
      break
    case 'heal-core': {
      const healed = Math.max(0, Math.min(50, player.hp + effect.amount) - player.hp)
      player.hp += healed
      if (healed) events.push(visible('core-healed', { seat, amount: healed, hp: player.hp }))
      break
    }
    case 'shield-core':
      player.coreShield += effect.amount
      events.push(visible('core-shielded', { seat, amount: effect.amount, shield: player.coreShield }))
      break
    case 'register-death-attack-bonus': {
      const unit = player.board.find(item => item.id === sourceId)
      if (unit) unit.deathAttackBonus = effect.amount
      break
    }
    case 'ice-draw-pick': {
      shuffle(player.ice, random)
      const cards = player.ice.splice(Math.max(0, player.ice.length - effect.amount))
      frame(state).choice = { kind: 'ice', seat, cards }
      break
    }
    case 'cancel-attack':
      frame(state).cancelAttack = true
      break
    default:
      throw new TypeError('Unknown effect in locked card pool')
  }
}

function performTask(context: RuleContext<OfficialMatchState>) {
  const { snapshot, random } = context
  const state = structuredClone(context.state)
  const task = frame(state).queue.shift()
  const events: VisibleRuleEvent[] = []
  if (!task) return { state, events }
  const player = state.seats[task.seat]
  switch (task.type) {
    case 'effect':
      executeEffect(state, snapshot, random, task, events)
      break
    case 'discard-played-ice':
      player.discard.push(task.card)
      events.push(visible('ice-discarded', { seat: task.seat, card: { id: task.card.id, cardId: task.card.cardId } }))
      break
    case 'death-bonuses':
      for (const unit of player.board) {
        if (!unit.deathAttackBonus) continue
        unit.attackBonus += unit.deathAttackBonus
        events.push(visible('death-attack-bonus', { seat: task.seat, unitId: unit.id, amount: unit.deathAttackBonus }))
      }
      break
    case 'response': {
      const cards = player.facedown.filter(card => effectsFor(snapshot, card, task.trigger).length > 0)
      if (cards.length) frame(state).choice = { kind: 'response', seat: task.seat, trigger: task.trigger, cards }
      break
    }
    case 'attack':
      finishAttack(state, snapshot, task, events)
      break
  }
  return { state, events }
}

function summonAllowed(state: OfficialMatchState, snapshot: CardPoolSnapshot, seat: SeatId, card: OfficialCardInstance) {
  const player = state.seats[seat]
  const condition = officialCardData(officialCard(snapshot, card.cardId)).summonCondition
  if (!condition) return true
  switch (condition.type) {
    case 'ownUnits':
      return player.board.filter(unit => officialCardData(officialCard(snapshot, unit.cardId)).attr === condition.attr).length >= condition.n
    case 'ownUnitName':
      return player.board.filter(unit => officialCard(snapshot, unit.cardId).name === condition.name).length >= (condition.n ?? 1)
    case 'ownGrave':
      return player.discard.length >= condition.n
    case 'coreHpAtMost':
      return player.hp <= condition.n
    case 'noOtherOwnUnits':
      return player.board.length === 0
    case 'lifeBehind':
      return player.hp < state.seats[opposingSeat(state, seat)].hp
  }
}

function boardFull(player: OfficialSeatState) {
  return player.board.length >= (player.iceEnabled ? 4 : 5)
}

function applyChoice(context: RuleContext<OfficialMatchState>, chosenIds: readonly string[]) {
  const state = structuredClone(context.state)
  const { snapshot } = context
  const choice = selection(state)
  const picked = choice.cards.find(card => card.id === chosenIds[0])
  if (!picked) throw new TypeError('Confirmed effect choice is missing a candidate')
  const { seat } = choice
  const player = state.seats[seat]
  const events: VisibleRuleEvent[] = []
  frame(state).choice = null

  if (choice.kind === 'search-deck') {
    const cards: { id: string; cardId: string }[] = []
    for (const chosenId of chosenIds) {
      const index = player.deck.findIndex(card => card.id === chosenId)
      if (index < 0) throw new TypeError('Confirmed searched card is missing from deck')
      const [card] = player.deck.splice(index, 1)
      player.hand.push(card)
      cards.push({ id: card.id, cardId: card.cardId })
    }
    events.push(visible('cards-searched', { seat, cards }, seat))
    return { state, events }
  }

  if (choice.kind === 'look-pick') {
    const index = player.deck.findIndex(card => card.id === picked.id)
    if (index < 0) throw new TypeError('Confirmed looked card is missing from deck')
    player.hand.push(...player.deck.splice(index, 1))
    if (choice.viewedCount > 1) shuffle(player.deck, context.random)
    events.push(visible('look-picked', { seat, card: { id: picked.id, cardId: picked.cardId } }, seat))
    return { state, events }
  }

  if (choice.kind === 'discard-hand' || choice.kind === 'hand-cost') {
    for (const chosenId of chosenIds) {
      const index = player.hand.findIndex(card => card.id === chosenId)
      if (index < 0) throw new TypeError('Confirmed discard is no longer in hand')
      const [card] = player.hand.splice(index, 1)
      player.discard.push(card)
      events.push(visible('hand-discarded', { seat, card: { id: card.id, cardId: card.cardId } }))
    }
    if (choice.kind === 'hand-cost') frame(state).queue.unshift(...choice.onSelect.map(effect => ({
      type: 'effect' as const, seat, sourceId: choice.sourceId, targetId: null, effect,
    })))
    return { state, events }
  }

  if (choice.kind === 'response') {
    const index = player.facedown.findIndex(card => card.id === picked.id)
    player.facedown.splice(index, 1)
    player.discard.push(picked)
    events.push(visible('response-revealed', { seat, card: { id: picked.id, cardId: picked.cardId } }))
    frame(state).queue.unshift(...effectTasks(snapshot, seat, picked, choice.trigger, null))
    return { state, events }
  }

  const unselected = choice.cards.filter(card => card.id !== picked.id)
  player.discard.push(...unselected)
  const visibleDiscard = [...unselected].sort((left, right) => left.id < right.id ? -1 : Number(left.id > right.id))
  for (const card of visibleDiscard) {
    events.push(visible('ice-discarded', { seat, card: { id: card.id, cardId: card.cardId } }))
  }
  const card = officialCard(snapshot, picked.cardId)
  const data = officialCardData(card)
  if (card.kind === 'ace' || (card.kind === 'unit' &&
    (data.evolveFrom?.length || boardFull(player) || !summonAllowed(state, snapshot, seat, picked)))) {
    player.ice.push(picked)
    events.push(visible('ice-returned', { seat, card: { id: picked.id, cardId: picked.cardId } }))
  } else {
    const trigger = card.kind === 'unit' ? 'enter' : 'play'
    if (card.kind === 'unit') player.board.push(newUnit(snapshot, picked))
    events.push(visible('ice-played', { seat, card: { id: picked.id, cardId: picked.cardId } }))
    frame(state).queue.unshift(...effectTasks(snapshot, seat, picked, trigger, null),
      ...(card.kind === 'unit' ? [] : [{ type: 'discard-played-ice' as const, seat, card: picked }]))
  }
  return { state, events }
}

const settlement: EffectProgram<OfficialMatchState, VisibleRuleEvent> = {
  entry: 'dispatch',
  steps: {
    dispatch: {
      kind: 'branch',
      next: ({ state }) => {
        if (state.effect?.choice) return 'choice'
        if (state.effect?.queue.length) return 'task'
        return state.effect?.deferredDeath.length ? 'flush-deferred' : 'clear'
      },
    },
    task: { kind: 'apply', apply: performTask, next: 'dispatch' },
    'flush-deferred': {
      kind: 'apply',
      apply: ({ state }) => {
        const next = structuredClone(state)
        const current = frame(next)
        current.queue.push(...current.deferredDeath)
        current.deferredDeath = []
        return { state: next }
      },
      next: 'dispatch',
    },
    choice: {
      kind: 'choose',
      choices: ({ state, snapshot }) => {
        const current = state.effect?.choice
        if (!current) throw new TypeError('No active effect choice')
        return {
          owner: current.seat,
          candidates: current.cards.map(({ id, cardId }) => ({
            id, payload: { cardId, name: officialCard(snapshot, cardId).name },
          })),
          count: current.kind === 'discard-hand' || current.kind === 'hand-cost' || current.kind === 'search-deck' ? current.amount : 1,
          mode: current.kind === 'hand-cost' ? 'condition' : 'result',
          ordered: false,
          canPass: current.kind === 'response' || (current.kind === 'hand-cost' && current.canPass),
          visibility: current.kind === 'response' || current.kind === 'discard-hand' || current.kind === 'hand-cost' || current.kind === 'look-pick' || current.kind === 'search-deck' ? 'owner' : 'public',
        }
      },
      apply: (context, answer) => applyChoice(context, answer.candidateIds),
      next: 'dispatch',
      pass: 'clear-choice',
      unavailable: 'clear-choice',
      empty: 'clear-choice',
    },
    'clear-choice': {
      kind: 'apply',
      apply: ({ state }) => {
        const next = structuredClone(state)
        frame(next).choice = null
        return { state: next }
      },
      next: 'dispatch',
    },
    clear: { kind: 'apply', apply: ({ state }) => ({ state: { ...state, effect: null } }) },
  },
}

const effects = createEffectRuntime({ settlement })

function resolveEffects(
  context: RuleContext<OfficialMatchState>, state: OfficialMatchState, queue: RuleTask[],
  events: readonly VisibleRuleEvent[], activeSeat = context.seat,
): OfficialResolution {
  state.effect = { queue, deferredDeath: [], cancelAttack: false, choice: null }
  const result = effects.start({ ...context, state }, 'settlement', activeSeat)
  if (result.kind === 'rejected') return result
  const allEvents = [...events, ...result.events]
  if (result.kind === 'active') return active(result.state, result.activeSeat, allEvents)
  return { ...result, events: allEvents }
}

function reject(reason: string): OfficialResolution {
  return { kind: 'rejected', reason }
}

function validEffectTarget(
  state: OfficialMatchState, snapshot: CardPoolSnapshot, seat: SeatId, card: OfficialCardInstance,
  trigger: OfficialTrigger, targets: readonly string[],
): boolean {
  const steps = effectsFor(snapshot, card, trigger).filter(effect => effect.type === 'damage-unit' || effect.type === 'destroy-unit' || effect.type === 'shield-unit' || effect.type === 'buff-unit')
  if (!steps.length) return targets.length === 0
  if (targets.length !== 1) return false
  const target = unitLocation(state, targets[0])
  return !!target && steps.every(effect =>
    (effect.target === 'any' || (effect.target === 'own' ? target.seat === seat : target.seat !== seat)) &&
    (effect.type !== 'buff-unit' || !effect.attr || officialCardData(officialCard(snapshot, target.unit.cardId)).attr === effect.attr))
}

function play(
  context: RuleContext<OfficialMatchState>, state: OfficialMatchState,
  action: Extract<PlayerAction, { readonly cardId: string }>,
): OfficialResolution {
  if (state.battleMode) return reject('hand-locked')
  const { snapshot, seat } = context
  const player = state.seats[seat]
  const index = player.hand.findIndex(card => card.id === action.cardId)
  const instance = player.hand[index]
  if (!instance) return reject('card-not-in-hand')
  const card = officialCard(snapshot, instance.cardId)
  const data = officialCardData(card)
  if (card.kind !== 'unit' && player.fieldLock && data.attr === player.fieldLock) return reject('field-locked')
  const targets = action.targets ?? []
  const trigger = card.kind === 'unit' ? 'enter' : 'play'
  const costs = effectsFor(snapshot, instance, trigger).filter(effect => effect.type === 'pay-life')
  if (costs.some(cost => cost.amount !== 'half' && player.hp <= cost.amount)) return reject('life-cost-unavailable')
  const events: VisibleRuleEvent[] = []
  let targetId: string | null = targets[0] ?? null
  if (data.oncePerTurn && player.usedCardIds.includes(card.id)) return reject('card-already-used')
  if (!summonAllowed(state, snapshot, seat, instance)) return reject('summon-condition-failed')

  if (action.type === 'evolve' || data.evolveFrom?.length) {
    const baseIndex = player.board.findIndex(unit => unit.id === targetId)
    const base = player.board[baseIndex]
    if (!base || targets.length !== 1 || !data.evolveFrom?.includes(base.cardId)) return reject('invalid-evolution-target')
    const evolved = newUnit(snapshot, instance)
    const previousHealth = officialCardData(officialCard(snapshot, base.cardId)).health ?? base.hp
    evolved.hp = Math.min(evolved.hp, base.hp + (evolved.hp - previousHealth))
    evolved.canAttack = !base.attacked && (evolved.canAttack || base.canAttack)
    evolved.attackBonus = base.attackBonus
    evolved.stealth = base.stealth
    evolved.stunned = base.stunned
    player.board[baseIndex] = evolved
    player.discard.push({ id: base.id, cardId: base.cardId })
    events.push(visible('evolved', { seat, fromId: base.id, card: { id: instance.id, cardId: instance.cardId } }))
    targetId = null
  } else {
    if (!validEffectTarget(state, snapshot, seat, instance, trigger, targets)) return reject('invalid-target')
    if (card.kind === 'unit') {
      if (boardFull(player)) return reject('board-full')
      player.board.push(newUnit(snapshot, instance))
    } else if (card.kind === 'trap') {
      if (player.facedown.length >= 3) return reject('facedown-full')
      player.facedown.push(instance)
    } else {
      if (card.kind === 'ace') {
        if (player.ap <= 0) return reject('insufficient-ap')
        player.ap--
      }
      player.discard.push(instance)
    }
    if (card.kind === 'trap') events.push(visible('card-covered', { seat }))
    else events.push(visible('card-played', { seat, card: { id: instance.id, cardId: instance.cardId } }))
  }
  player.hand.splice(index, 1)
  if (data.oncePerTurn) player.usedCardIds.push(card.id)
  return resolveEffects(context, state, effectTasks(snapshot, seat, instance, trigger, targetId), events)
}

function attack(
  context: RuleContext<OfficialMatchState>, state: OfficialMatchState,
  action: Extract<PlayerAction, { readonly type: 'attack' }>,
): OfficialResolution {
  const { snapshot, seat } = context
  const { attackerId, targetId } = action
  const player = state.seats[seat]
  const attacker = player.board.find(unit => unit.id === attackerId)
  if (player.selfAttackLock) return reject('own-attacks-locked')
  if (!attacker || !attacker.canAttack || attacker.attacked || attacker.stunned || attacker.skillLock) {
    return reject('attacker-unavailable')
  }
  if (!state.finale && player.ap <= 0) return reject('insufficient-ap')
  const opponent = opposingSeat(state, seat)
  const defending = state.seats[opponent]
  const toCore = targetId === coreTargetId(opponent)
  if (toCore) {
    if (state.turn === 1 || defending.board.length) return reject('core-protected')
  } else {
    const target = defending.board.find(unit => unit.id === targetId)
    if (!target || target.stealth) return reject('invalid-target')
    if (!hasKeyword(snapshot, target, 'guard', '守护') &&
        defending.board.some(unit => hasKeyword(snapshot, unit, 'guard', '守护'))) return reject('target-protected')
  }
  return resolveEffects(context, state, [
    { type: 'response', seat: opponent, trigger: toCore ? 'attack-core' : 'attack-unit' },
    { type: 'attack', seat, attackerId, targetId },
  ], [])
}

function endTurn(context: RuleContext<OfficialMatchState>, state: OfficialMatchState): OfficialResolution {
  const { seat, snapshot, random } = context
  const player = state.seats[seat]
  const events: VisibleRuleEvent[] = []
  state.battleMode = false
  player.usedCardIds = []
  player.fieldLock = null
  player.selfAttackLock = false
  player.board.forEach(unit => {
    unit.attacked = false
    unit.skillUsed = false
    unit.skillLock = false
    unit.stunned = false
    unit.deathAttackBonus = 0
    unit.attackBonus = 0
  })
  while (player.hand.length > 7) {
    const card = player.hand.pop()!
    player.discard.push(card)
    events.push(visible('hand-limit-discard', { seat, card: { id: card.id, cardId: card.cardId } }))
  }
  const finaleValue = state.seatOrder.reduce((count, id) => count + state.seats[id].discard.length, 0)
  if (!state.finale && finaleValue >= 40) {
    state.finale = { by: seat, atTurn: state.turn }
    events.push(visible('finale-started', { seat, turn: state.turn, value: finaleValue }))
    for (const [index, id] of state.seatOrder.entries()) {
      const side = state.seats[id]
      side.deck.push(...side.hand)
      side.hand = []
      shuffle(side.deck, random)
      draw(state, id, index === 0 ? 6 : 7, events)
    }
  }
  const nextSeat = opposingSeat(state, seat)
  startTurn(state, snapshot, nextSeat, events)
  return active(state, nextSeat, events)
}

export const officialRules: Ruleset<OfficialMatchState, PlayerAction, EffectContinuation, OfficialRuleEvent> = {
  version: OFFICIAL_RULES_VERSION,
  artifact: {
    capabilities,
    sources: { rules: rulesSource, state: stateSource, effects: effectSource, core: coreSource },
  },
  canInterrupt: action => action.type === 'concede',
  resolveAction(context) {
    const { seat, action, snapshot, random } = context
    const state: OfficialMatchState = structuredClone(context.state)
    if (!state.seatOrder.includes(seat)) return reject('wrong-seat')
    const player = state.seats[seat]
    switch (action.type) {
      case 'mulligan': {
        if (state.turn !== 1 || player.mulliganUsed) return reject('mulligan-unavailable')
        const ids = new Set(action.cardIds)
        if (!player.hand.length || ids.size !== player.hand.length || action.cardIds.length !== ids.size ||
            player.hand.some(card => !ids.has(card.id))) return reject('invalid-mulligan')
        const count = player.hand.length
        player.deck.unshift(...player.hand)
        player.hand = []
        shuffle(player.deck, random)
        const events = [visible('mulligan', { seat, count }, seat)]
        draw(state, seat, count, events)
        player.mulliganUsed = true
        return active(state, seat, events)
      }
      case 'begin-battle':
        if (state.battleMode) return reject('already-in-battle')
        state.battleMode = true
        return active(state, seat, [visible('battle-started', { seat })])
      case 'play-card':
      case 'evolve':
        return play(context, state, action)
      case 'attack':
        return attack(context, state, action)
      case 'activate-skill': {
        const source = player.board.find(unit => unit.id === action.sourceId)
        if (!source) return reject('invalid-skill-source')
        const sourceData = officialCardData(officialCard(snapshot, source.cardId))
        if (player.fieldLock && sourceData.attr === player.fieldLock) return reject('field-locked')
        const skill = sourceData.skill
        if (!skill || skill.id !== action.skillId) return reject('invalid-skill')
        if (skill.oncePerTurn && source.skillUsed) return reject('skill-already-used')
        const costs = effectsFor(snapshot, source, 'skill').filter(effect => effect.type === 'pay-life')
        if (costs.some(cost => cost.amount !== 'half' && player.hp <= cost.amount)) return reject('life-cost-unavailable')
        if (!validEffectTarget(state, snapshot, seat, source, 'skill', action.targets ?? [])) return reject('invalid-target')
        source.skillUsed = true
        if (skill.lock) source.skillLock = true
        const queue = effectTasks(snapshot, seat, source, 'skill', action.targets?.[0] ?? null)
        return resolveEffects(context, state, queue, [visible('skill-activated', { seat, sourceId: source.id, skillId: skill.id })])
      }
      case 'end-turn':
        return endTurn(context, state)
      case 'concede': {
        const choice = state.effect?.choice
        if (choice?.kind === 'ice') state.seats[choice.seat].ice.push(...choice.cards)
        state.effect = null
        return { kind: 'ended', state, events: [visible('conceded', { seat })],
          outcome: { winner: opposingSeat(state, seat), reason: 'conceded' } }
      }
      case 'respond':
        return reject('decision-expired')
    }
  },
  resumeDecision(context) {
    const result = effects.resume(context)
    return result.kind === 'active' ? active(result.state, result.activeSeat, result.events) : result
  },
}
