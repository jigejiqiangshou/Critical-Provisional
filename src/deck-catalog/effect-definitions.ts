import inventory from './legacy-effect-inventory.json'
import type { OfficialEffect, OfficialTrigger } from '../match/official-state'

/** Legacy name based IDs are deterministic across extraction runs and client editions. */
export const legacyEffectInventory = inventory
export type MigratedEffect = { readonly sourcePath: string; readonly trigger: OfficialTrigger; readonly steps: readonly OfficialEffect[] }
export type EffectMapping = { readonly cardId: string; readonly effects: readonly MigratedEffect[] }
const id = (name: string) => `legacy:${encodeURIComponent(name)}`

// These registrations correspond to the already implemented LG-04–LG-08 primitives.
// All other entries remain explicitly unmapped until their semantics are implemented.
export const initialEffectMappings: readonly EffectMapping[] = [
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

export interface EffectCapabilities {
  readonly triggers: readonly string[]
  readonly effects: readonly string[]
}

/** Each legacy entry is independently accounted for, including non-active rule features. */
export function legacyEffectPaths(card: Record<string, unknown>): string[] {
  const keys = ['kw', 'deathrattle', 'skill', 'passive', 'enter', 'effect', 'fieldLock',
    'evolveFrom', 'divine', 'summonCondition', 'onEvent', 'once', 'trap', 'shield',
    'overheat', 'selfAttackLock', 'sacrifice', 'atkGrowth']
  return keys.flatMap(key => {
    const value = card[key]
    if (value === undefined) return []
    return Array.isArray(value) ? value.map((_, index) => `${key}[${index}]`) : [key]
  })
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
    const required = new Set(legacyEffectPaths(source.card))
    const paths = new Set<string>()
    for (const effect of mapping.effects) {
      if (!required.has(effect.sourcePath)) throw new Error(`Unknown source entry ${effect.sourcePath}: ${mapping.cardId}`)
      if (paths.has(effect.sourcePath)) throw new Error(`Duplicate source entry ${effect.sourcePath}: ${mapping.cardId}`)
      paths.add(effect.sourcePath)
      if (!capabilities.triggers.includes(effect.trigger)) throw new Error(`Unknown trigger ${effect.trigger}: ${mapping.cardId}`)
      if (!effect.steps.length) throw new Error(`Empty effect steps: ${mapping.cardId}`)
      for (const step of effect.steps) {
        if (!capabilities.effects.includes(step.type)) throw new Error(`Unimplemented effect ${step.type}: ${mapping.cardId}`)
      }
    }
    const missingPaths = [...required].filter(path => !paths.has(path))
    if (missingPaths.length) throw new Error(`Missing source entries ${missingPaths.join(', ')}: ${mapping.cardId}`)
  }
  const missing = sources.filter(source => !seen.has(source.id))
  if (missing.length) throw new Error(`Missing effect mappings (${missing.length}): ${missing.map(x => x.id).join(', ')}`)
}
