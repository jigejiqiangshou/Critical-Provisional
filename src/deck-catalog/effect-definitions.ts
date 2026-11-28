import inventory from './legacy-effect-inventory.json'
import type { OfficialEffect, OfficialTrigger } from '../match/official-state'

/** Legacy name based IDs are deterministic across extraction runs and client editions. */
export const legacyEffectInventory = inventory
export type MigratedEffect = { readonly sourcePath: string; readonly trigger: OfficialTrigger; readonly steps: readonly OfficialEffect[] }
export type EffectMapping = { readonly cardId: string; readonly effects: readonly MigratedEffect[] }
const id = (name: string) => `legacy:${encodeURIComponent(name)}`

// These registrations correspond to the already implemented LG-04–LG-08 primitives.
// All other entries remain explicitly unmapped until their semantics are implemented.
const handCheckedMappings: readonly EffectMapping[] = [
  { cardId: id('毕方'), effects: [{ sourcePath: 'deathrattle', trigger: 'death', steps: [{ type: 'draw', amount: 1 }] }] },
  { cardId: id('冰夷'), effects: [{ sourcePath: 'deathrattle', trigger: 'death', steps: [{ type: 'draw', amount: 1 }] }] },
  { cardId: id('青苗'), effects: [{ sourcePath: 'deathrattle', trigger: 'death', steps: [{ type: 'draw', amount: 1 }] }] },
  { cardId: id('青鸾'), effects: [{ sourcePath: 'enter[0]', trigger: 'enter', steps: [{ type: 'draw', amount: 1 }] }] },
  { cardId: id('春风'), effects: [{ sourcePath: 'effect', trigger: 'play', steps: [{ type: 'heal-core', amount: 5 }] }] },
  { cardId: id('复苏'), effects: [{ sourcePath: 'effect', trigger: 'play', steps: [{ type: 'heal-core', amount: 8 }] }] },
  { cardId: id('回天'), effects: [{ sourcePath: 'effect', trigger: 'play', steps: [{ type: 'heal-core', amount: 12 }] }] },
  { cardId: id('麒麟'), effects: [{ sourcePath: 'enter[0]', trigger: 'enter', steps: [{ type: 'heal-core', amount: 3 }] }] },
  { cardId: id('龟息'), effects: [{ sourcePath: 'effect', trigger: 'play', steps: [
    { type: 'heal-core', amount: 6 }, { type: 'shield-core', amount: 3 },
  ] }] },
  { cardId: id('搏命'), effects: [
    { sourcePath: 'effect[0]', trigger: 'play', steps: [{ type: 'pay-half-life' }] },
    { sourcePath: 'effect[1]', trigger: 'play', steps: [{ type: 'draw', amount: 5 }] },
  ] },
  { cardId: id('燎原'), effects: [{ sourcePath: 'effect', trigger: 'play', steps: [{ type: 'damage-all-enemies', amount: 3 }] }] },
  { cardId: id('祝融'), effects: [{ sourcePath: 'skill', trigger: 'skill', steps: [{ type: 'damage-all-enemies', amount: 2 }] }] },
  { cardId: id('蓐收'), effects: [{ sourcePath: 'skill', trigger: 'skill', steps: [{ type: 'damage-all-enemies', amount: 2 }] }] },
  { cardId: id('凝霜'), effects: [{ sourcePath: 'effect', trigger: 'play', steps: [{ type: 'shield-unit', amount: 5, target: 'any' }] }] },
  { cardId: id('血涟'), effects: [
    { sourcePath: 'effect[0]', trigger: 'play', steps: [{ type: 'pay-life', amount: 3 }] },
    { sourcePath: 'effect[1]', trigger: 'play', steps: [{ type: 'shield-unit', amount: 3, target: 'any' }] },
  ] },
  { cardId: id('弱水'), effects: [{ sourcePath: 'effect', trigger: 'play', steps: [{ type: 'stun-unit', target: 'any' }] }] },
  { cardId: id('缚龙索'), effects: [
    { sourcePath: 'effect[0]', trigger: 'play', steps: [{ type: 'stun-unit', target: 'any' }] },
    { sourcePath: 'effect[1]', trigger: 'play', steps: [{ type: 'damage-unit', amount: 2, target: 'any' }] },
  ] },
  { cardId: id('冰尉'), effects: [{ sourcePath: 'enter[0]', trigger: 'enter', steps: [{ type: 'shield-all', amount: 1, excludeSource: true }] }] },
  { cardId: id('玄武·执明'), effects: [{ sourcePath: 'skill', trigger: 'skill', steps: [{ type: 'shield-all', amount: 2, excludeSource: false }] }] },
  { cardId: id('火鸦'), effects: [{ sourcePath: 'skill', trigger: 'skill', steps: [{ type: 'register-death-attack-bonus', amount: 1 }] }] },
  { cardId: id('离火'), effects: [{ sourcePath: 'effect', trigger: 'play', steps: [{ type: 'damage-unit', target: 'any', amount: 5 }] }] },
  { cardId: id('传讯'), effects: [{ sourcePath: 'effect', trigger: 'play', steps: [{ type: 'draw', amount: 1 }] }] },
  { cardId: id('炎纹'), effects: [
    { sourcePath: 'effect[0]', trigger: 'play', steps: [{ type: 'damage-unit', target: 'any', amount: 3 }] },
    { sourcePath: 'effect[1]', trigger: 'play', steps: [{ type: 'draw', amount: 1 }] },
  ] },
  { cardId: id('镇岳'), effects: [{ sourcePath: 'trap', trigger: 'attack-core', steps: [{ type: 'cancel-attack' }] }] },
  { cardId: id('探珠'), effects: [{ sourcePath: 'skill', trigger: 'skill', steps: [{ type: 'ice-draw-pick', amount: 3 }] }] },
]

/** Translate only exact legacy primitive shapes with equivalent core steps. */
function translatePrimitive(value: unknown, text: string): OfficialEffect | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const item = value as Record<string, unknown>
  const type = item.type
  const target = text.includes('目标你的单位') ? 'own' : text.includes('目标对方单位') ? 'enemy' :
    text.includes('目标单位') ? 'any' : undefined
  if (type === 'stun' && target && Object.keys(item).length === 1) return { type: 'stun-unit', target }
  if (type === 'payLifeHalf' && Object.keys(item).length === 1) return { type: 'pay-half-life' }
  if (Object.keys(item).length !== 2 || typeof item.n !== 'number' || !Number.isInteger(item.n) || item.n < 0) return
  switch (type) {
    case 'unit': return target ? { type: 'damage-unit', target, amount: item.n } : undefined
    case 'shieldUnit': return target ? { type: 'shield-unit', target, amount: item.n } : undefined
    case 'aoe': return { type: 'damage-all-enemies', amount: item.n }
    case 'draw': return { type: 'draw', amount: item.n }
    case 'heal': return { type: 'heal-core', amount: item.n }
    case 'payLife': return { type: 'pay-life', amount: item.n }
  }
}

function automaticEntries(card: Record<string, unknown>): MigratedEffect[] {
  const result: MigratedEffect[] = []
  const add = (key: string, trigger: OfficialTrigger) => {
    const value = card[key]
    if (value === undefined) return
    const entries = Array.isArray(value) ? value : [value]
    entries.forEach((entry, index) => {
      const step = translatePrimitive(entry, typeof card.text === 'string' ? card.text : '')
      if (step) result.push({ sourcePath: Array.isArray(value) ? `${key}[${index}]` : key, trigger, steps: [step] })
    })
  }
  if (card.type === 'spell' || card.type === 'ace') add('effect', 'play')
  if (card.type === 'unit') { add('enter', 'enter'); add('deathrattle', 'death') }
  return result
}

export const initialEffectMappings: readonly EffectMapping[] = inventory.map(source => {
  const checked = handCheckedMappings.find(mapping => mapping.cardId === source.id)?.effects ?? []
  const occupied = new Set(checked.map(effect => effect.sourcePath))
  const order = legacyEffectPaths(source.card)
  const effects = [...checked, ...automaticEntries(source.card).filter(effect => !occupied.has(effect.sourcePath))]
  effects.sort((left, right) => order.indexOf(left.sourcePath) - order.indexOf(right.sourcePath))
  return { cardId: source.id, effects }
})

export interface EffectCapabilities {
  readonly triggers: readonly string[]
  readonly effects: readonly string[]
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}

/** Each legacy entry is independently accounted for, including non-active rule features. */
export function legacyEffectPaths(card: Record<string, unknown>): string[] {
  const keys = ['kw', 'deathrattle', 'skill', 'passive', 'enter', 'effect', 'fieldLock',
    'evolveFrom', 'divine', 'summonCondition', 'onEvent', 'once', 'trap', 'shield',
    'overheat', 'selfAttackLock', 'sacrifice', 'atkGrowth']
  const metadata = new Set(['name', 'attr', 'type', 'atk', 'hp', 'text', 'evoStage'])
  const unknown = Object.keys(card).filter(key => !metadata.has(key) && !keys.includes(key)).map(key => `unknown:${key}`)
  return [...unknown, ...keys.flatMap(key => {
    const value = card[key]
    if (value === undefined) return []
    return Array.isArray(value) ? value.map((_, index) => `${key}[${index}]`) : [key]
  })]
}

/** Fail closed until every source entry has an explicit, supported mapping. */
export function validateInitialEffects(
  sources: readonly { readonly id: string; readonly card: Record<string, unknown> }[],
  mappings: readonly EffectMapping[], capabilities: EffectCapabilities,
): void {
  const expected = new Map(sources.map(source => [source.id, source]))
  if (expected.size !== sources.length) throw new Error('Duplicate source card ID')
  const seen = new Set<string>()
  for (const mapping of mappings) {
    const source = expected.get(mapping.cardId)
    if (!source) throw new Error(`Unknown source card: ${mapping.cardId}`)
    if (seen.has(mapping.cardId)) throw new Error(`Duplicate effect mapping: ${mapping.cardId}`)
    seen.add(mapping.cardId)
    const sourcePaths = legacyEffectPaths(source.card)
    if (sourcePaths.some(path => path.startsWith('unknown:'))) throw new Error(`Unknown legacy field: ${mapping.cardId}`)
    const required = new Set(sourcePaths)
    const paths = new Set<string>()
    let lastIndex = -1
    const checked = handCheckedMappings.find(entry => entry.cardId === mapping.cardId)?.effects ?? []
    const lockedSource = inventory.find(entry => entry.id === mapping.cardId)
    if (checked.length && (!lockedSource || canonical(source.card) !== canonical(lockedSource.card)))
      throw new Error(`Legacy source changed: ${mapping.cardId}`)
    const automatic = automaticEntries(source.card)
    for (const effect of mapping.effects) {
      if (!required.has(effect.sourcePath)) throw new Error(`Unknown source entry ${effect.sourcePath}: ${mapping.cardId}`)
      if (paths.has(effect.sourcePath)) throw new Error(`Duplicate source entry ${effect.sourcePath}: ${mapping.cardId}`)
      const index = sourcePaths.indexOf(effect.sourcePath)
      if (index <= lastIndex) throw new Error(`Out-of-order source entry ${effect.sourcePath}: ${mapping.cardId}`)
      lastIndex = index
      paths.add(effect.sourcePath)
      if (!capabilities.triggers.includes(effect.trigger)) throw new Error(`Unknown trigger ${effect.trigger}: ${mapping.cardId}`)
      if (!effect.steps.length) throw new Error(`Empty effect steps: ${mapping.cardId}`)
      for (const step of effect.steps) {
        if (!capabilities.effects.includes(step.type)) throw new Error(`Unimplemented effect ${step.type}: ${mapping.cardId}`)
      }
      const expectedEffect = checked.find(entry => entry.sourcePath === effect.sourcePath) ??
        automatic.find(entry => entry.sourcePath === effect.sourcePath)
      if (!expectedEffect || canonical(effect) !== canonical(expectedEffect))
        throw new Error(`Unverified source semantics ${effect.sourcePath}: ${mapping.cardId}`)
    }
    const missingPaths = [...required].filter(path => !paths.has(path))
    if (missingPaths.length) throw new Error(`Missing source entries ${missingPaths.join(', ')}: ${mapping.cardId}`)
  }
  const missing = sources.filter(source => !seen.has(source.id))
  if (missing.length) throw new Error(`Missing effect mappings (${missing.length}): ${missing.map(x => x.id).join(', ')}`)
}
