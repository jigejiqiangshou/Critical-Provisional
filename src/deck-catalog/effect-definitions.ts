import inventory from './legacy-effect-inventory.json'
import type { OfficialEffect, OfficialTrigger } from '../match/official-state'

/** Legacy name based IDs are deterministic across extraction runs and client editions. */
export const legacyEffectInventory = inventory
export type MigratedEffect = { readonly trigger: OfficialTrigger; readonly steps: readonly OfficialEffect[] }
export type EffectMapping = { readonly cardId: string; readonly effects: readonly MigratedEffect[] }
const id = (name: string) => `legacy:${encodeURIComponent(name)}`

// These registrations correspond to the already implemented LG-04–LG-08 primitives.
// All other entries remain explicitly unmapped until their semantics are implemented.
export const initialEffectMappings: readonly EffectMapping[] = [
  { cardId: id('毕方'), effects: [{ trigger: 'death', steps: [{ type: 'draw', amount: 1 }] }] },
  { cardId: id('火鸦'), effects: [{ trigger: 'skill', steps: [{ type: 'register-death-attack-bonus', amount: 1 }] }] },
  { cardId: id('离火'), effects: [{ trigger: 'play', steps: [{ type: 'damage-unit', target: 'any', amount: 5 }] }] },
  { cardId: id('镇岳'), effects: [{ trigger: 'attack-core', steps: [{ type: 'cancel-attack' }] }] },
  { cardId: id('探珠'), effects: [{ trigger: 'skill', steps: [{ type: 'ice-draw-pick', amount: 3 }] }] },
]

export interface EffectCapabilities {
  readonly triggers: readonly string[]
  readonly effects: readonly string[]
}

/** Fail closed until every source card has an explicit, supported mapping. */
export function validateInitialEffects(
  sources: readonly { readonly id: string }[], mappings: readonly EffectMapping[], capabilities: EffectCapabilities,
): void {
  const expected = new Set(sources.map(source => source.id))
  if (expected.size !== sources.length) throw new Error('Duplicate source card ID')
  const seen = new Set<string>()
  for (const mapping of mappings) {
    if (!expected.has(mapping.cardId)) throw new Error(`Unknown source card: ${mapping.cardId}`)
    if (seen.has(mapping.cardId)) throw new Error(`Duplicate effect mapping: ${mapping.cardId}`)
    seen.add(mapping.cardId)
    // Empty registrations cannot establish that a legacy effect was migrated.
    if (!mapping.effects.length) throw new Error(`Empty effect mapping: ${mapping.cardId}`)
    for (const effect of mapping.effects) {
      if (!capabilities.triggers.includes(effect.trigger)) throw new Error(`Unknown trigger ${effect.trigger}: ${mapping.cardId}`)
      if (!effect.steps.length) throw new Error(`Empty effect steps: ${mapping.cardId}`)
      for (const step of effect.steps) {
        if (!capabilities.effects.includes(step.type)) throw new Error(`Unimplemented effect ${step.type}: ${mapping.cardId}`)
      }
    }
  }
  const missing = sources.filter(source => !seen.has(source.id))
  if (missing.length) throw new Error(`Missing effect mappings (${missing.length}): ${missing.map(x => x.id).join(', ')}`)
}
