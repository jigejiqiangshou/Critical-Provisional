import type { Card, Release } from '../deck-catalog/catalog'
import type { CardPoolSnapshot, SeatId } from './rules'

export const OFFICIAL_RULES_VERSION = '1'

export type OfficialTrigger = 'play' | 'enter' | 'death' | 'skill' | 'attack-core' | 'attack-unit'
export type OfficialEffect =
  | { readonly type: 'damage-unit'; readonly amount: number; readonly target: 'any' | 'own' | 'enemy'; readonly pierce?: boolean }
  | { readonly type: 'damage-all-enemies'; readonly amount: number; readonly pierce: boolean }
  | { readonly type: 'destroy-unit'; readonly target: 'any' | 'own' | 'enemy' }
  | { readonly type: 'shield-unit'; readonly target: 'any' | 'own' | 'enemy'; readonly amount: number }
  | { readonly type: 'buff-unit'; readonly target: 'any' | 'own' | 'enemy'; readonly attack: number; readonly health: number; readonly rush?: boolean; readonly attr?: string }
  | { readonly type: 'shield-all-own'; readonly amount: number; readonly excludeSource: boolean }
  | { readonly type: 'lock-field'; readonly attr: string }
  | { readonly type: 'lock-own-attacks' }
  | { readonly type: 'discard-hand'; readonly amount: number }
  | { readonly type: 'hand-cost'; readonly amount: number; readonly canPass: boolean; readonly onSelect: readonly OfficialEffect[] }
  | { readonly type: 'pay-life'; readonly amount: number | 'half' }
  | { readonly type: 'look-pick'; readonly top: number; readonly kind?: 'unit'; readonly attr?: string }
  | { readonly type: 'search-deck'; readonly amount: number; readonly kind?: 'unit' | 'spell'; readonly attr?: string;
      readonly names?: readonly string[]; readonly evoStage?: number; readonly evoStageMin?: number;
      readonly attackMin?: number; readonly healthMin?: number; readonly keyword?: string }
  | { readonly type: 'draw' | 'register-death-attack-bonus' | 'ice-draw-pick'; readonly amount: number }
  | { readonly type: 'heal-core' | 'shield-core' | 'bonus-core-attack' | 'pre-strike'; readonly amount: number }
  | { readonly type: 'cancel-attack' }

type SummonCondition =
  | { readonly type: 'ownUnits'; readonly attr: string; readonly n: number }
  | { readonly type: 'ownUnitName'; readonly name: string; readonly n?: number }
  | { readonly type: 'ownGrave' | 'coreHpAtMost'; readonly n: number }
  | { readonly type: 'noOtherOwnUnits' | 'lifeBehind' }

export interface OfficialCardData {
  readonly attack?: number
  readonly health?: number
  readonly evoStage?: number
  readonly attr?: string
  readonly keywords?: readonly string[]
  readonly shield?: number
  readonly evolveFrom?: readonly string[]
  readonly summonCondition?: SummonCondition
  readonly skill?: { readonly id: string; readonly oncePerTurn?: boolean; readonly lock?: boolean }
  readonly oncePerTurn?: boolean
  readonly effects?: readonly { readonly trigger: OfficialTrigger; readonly steps: readonly OfficialEffect[]; readonly timing?: 'immediate' | 'after-action' }[]
}

export interface OfficialCardInstance {
  readonly id: string
  readonly cardId: string
}

export interface OfficialUnit extends OfficialCardInstance {
  hp: number
  canAttack: boolean
  attacked: boolean
  skillUsed: boolean
  skillLock: boolean
  attackBonus: number
  deathAttackBonus: number
  stealth: boolean
  stunned: boolean
  shield: number
}

export interface OfficialSeatState {
  hp: number
  ap: number
  ownTurn: number
  fatigue: number
  coreShield: number
  temporaryHealth: number
  mulliganUsed: boolean
  iceEnabled: boolean
  fieldLock: string | null
  selfAttackLock: boolean
  usedCardIds: string[]
  deck: OfficialCardInstance[]
  hand: OfficialCardInstance[]
  board: OfficialUnit[]
  discard: OfficialCardInstance[]
  facedown: OfficialCardInstance[]
  ice: OfficialCardInstance[]
}

type RuleTask =
  | { readonly type: 'effect'; readonly seat: SeatId; readonly sourceId: string;
      readonly targetId: string | null; readonly effect: OfficialEffect; readonly timing?: 'immediate' | 'after-action' }
  | { readonly type: 'death-bonuses'; readonly seat: SeatId }
  | { readonly type: 'discard-played-ice'; readonly seat: SeatId; readonly card: OfficialCardInstance }
  | { readonly type: 'response'; readonly seat: SeatId; readonly trigger: 'attack-core' | 'attack-unit' }
  | { readonly type: 'attack'; readonly seat: SeatId; readonly attackerId: string; readonly targetId: string }

type ChoiceFrame =
  | { readonly kind: 'response'; readonly seat: SeatId; readonly trigger: 'attack-core' | 'attack-unit';
      readonly cards: readonly OfficialCardInstance[] }
  | { readonly kind: 'ice'; readonly seat: SeatId; readonly cards: readonly OfficialCardInstance[] }
  | { readonly kind: 'discard-hand'; readonly seat: SeatId; readonly cards: readonly OfficialCardInstance[]; readonly amount: number }
  | { readonly kind: 'hand-cost'; readonly seat: SeatId; readonly cards: readonly OfficialCardInstance[]; readonly amount: number; readonly canPass: boolean; readonly sourceId: string; readonly onSelect: readonly OfficialEffect[] }
  | { readonly kind: 'look-pick'; readonly seat: SeatId; readonly cards: readonly OfficialCardInstance[]; readonly viewedCount: number }
  | { readonly kind: 'search-deck'; readonly seat: SeatId; readonly cards: readonly OfficialCardInstance[]; readonly amount: number }

interface EffectFrame {
  queue: RuleTask[]
  deferredDeath: RuleTask[]
  cancelAttack: boolean
  choice: ChoiceFrame | null
}

export type { ChoiceFrame, RuleTask }

export interface OfficialMatchState {
  readonly seatOrder: readonly [SeatId, SeatId]
  readonly seats: Record<SeatId, OfficialSeatState>
  turn: number
  finale: { readonly by: SeatId; readonly atTurn: number } | null
  battleMode: boolean
  effect: EffectFrame | null
}

export interface OfficialSeatSetup {
  readonly seatId: SeatId
  /** Stable IDs in draw order, before the initial shuffle. */
  readonly deck: readonly string[]
  readonly iceEnabled?: boolean
}

export function createOfficialSeatState(
  deck: readonly OfficialCardInstance[] = [],
  iceEnabled = false,
): OfficialSeatState {
  return {
    hp: 50,
    ap: 0,
    ownTurn: 0,
    fatigue: 0,
    coreShield: 0,
    temporaryHealth: 0,
    mulliganUsed: false,
    iceEnabled,
    fieldLock: null,
    selfAttackLock: false,
    usedCardIds: [],
    deck: [...deck],
    hand: [],
    board: [],
    discard: [],
    facedown: [],
    ice: [],
  }
}

export function createOfficialSnapshot(release: Release): CardPoolSnapshot {
  return {
    id: release.id,
    rulesVersion: release.rulesVersion,
    content: {
      cards: release.cards.map(({ id, name, kind, flagship, data }) => ({ id, name, kind, flagship, data })),
      presets: release.presets.map(({ id, name, entries }) => ({
        id, name, entries: entries.map(({ cardId, quantity }) => ({ cardId, quantity })),
      })),
    },
  }
}

export function officialCards(snapshot: CardPoolSnapshot): readonly Card[] {
  const content = snapshot.content
  if (!content || typeof content !== 'object' || Array.isArray(content) || !('cards' in content)
    || !Array.isArray(content.cards)) throw new TypeError('Invalid official card pool')
  return content.cards as unknown as readonly Card[]
}

export function officialCard(snapshot: CardPoolSnapshot, id: string): Card {
  const card = officialCards(snapshot).find((entry) => entry.id === id)
  if (!card) throw new TypeError('Unknown card in locked pool: ' + id)
  return card
}

export function officialCardData(card: Card): OfficialCardData {
  return card.data as OfficialCardData
}

export function opposingSeat(state: Readonly<OfficialMatchState>, seat: SeatId): SeatId {
  return state.seatOrder[0] === seat ? state.seatOrder[1] : state.seatOrder[0]
}

export function coreTargetId(seat: SeatId): string {
  return 'core:' + seat
}
