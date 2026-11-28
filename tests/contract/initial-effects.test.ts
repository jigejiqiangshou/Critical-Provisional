import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fixture from '../baseline/fixtures.json'
import { getRuleCapabilities, OFFICIAL_RULES_VERSION } from '../../src/match/rules'
import { initialEffectMappings, legacyEffectInventory, validateInitialEffects } from '../../src/deck-catalog/effect-definitions'

describe('first release legacy effect inventory', () => {
  it('contains each independently pinned 2D and 3D legacy card, with locatable source lines', () => {
    expect(legacyEffectInventory).toHaveLength(129)
    expect(new Set(legacyEffectInventory.map(item => item.id)).size).toBe(129)
    for (const edition of ['2d', '3d'] as const) {
      const reference = fixture.cardDefinitions[edition] as Record<string, unknown>
      expect(legacyEffectInventory.map(item => item.name).sort()).toEqual(Object.keys(reference).sort())
      for (const item of legacyEffectInventory) {
        expect(item.card).toEqual(reference[item.name])
        const location = item.sources.find(source => source.path.includes(edition === '2d' ? '2D版' : '3D版'))
        expect(location).toBeDefined()
        const line = readFileSync(location!.path, 'utf8').split('\n')[location!.line - 1]
        expect(line).toContain(`name:'${item.name}'`)
      }
    }
  })

  it('rejects the incomplete initial mappings using the actual rules capabilities', () => {
    const capabilities = getRuleCapabilities(OFFICIAL_RULES_VERSION)
    expect(capabilities).toBeDefined()
    expect(() => validateInitialEffects(legacyEffectInventory, initialEffectMappings, capabilities!)).toThrow()
  })

  it('rejects unknown triggers and effects even when all IDs are present', () => {
    const source = [{ id: 'test-card', card: { effect: { type: 'draw', n: 1 } } }]
    const capabilities = { triggers: ['play'], effects: ['draw'] }
    const valid = [{ cardId: 'test-card', effects: [{ sourcePath: 'effect', trigger: 'play' as const, steps: [{ type: 'draw' as const, amount: 1 }] }] }]
    expect(() => validateInitialEffects(source, valid, capabilities)).not.toThrow()
    expect(() => validateInitialEffects(source, [], capabilities)).toThrow()
    expect(() => validateInitialEffects(source, [...valid, ...valid], capabilities)).toThrow()
    expect(() => validateInitialEffects(source, valid, { triggers: [], effects: ['draw'] })).toThrow()
    expect(() => validateInitialEffects(source, valid, { triggers: ['play'], effects: [] })).toThrow()
  })
})
