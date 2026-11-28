import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fixture from '../baseline/fixtures.json'
import sources from '../../src/deck-catalog/legacy-card-sources.json'
import { assertInitialEffectsReady, validateInitialEffectAudits } from '../../src/deck-catalog/effect-definitions'

describe('independent first release effect acceptance', () => {
  it('accounts for each card in both legacy game sources and its printed face', () => {
    expect(sources).toHaveLength(129)
    expect(new Set(sources.map(item => item.name)).size).toBe(129)
    for (const edition of ['2d', '3d'] as const) {
      const reference = fixture.cardDefinitions[edition] as Record<string, { text: string }>
      expect(sources.map(item => item.name).sort()).toEqual(Object.keys(reference).sort())
      const path = `quote/临界·模块化·${edition.toUpperCase()}版.html`
      const lines = readFileSync(path, 'utf8').split('\n')
      for (const item of sources) {
        expect(item.faceText).toBe(reference[item.name].text)
        expect(lines[(edition === '2d' ? item.line2d : item.line3d) - 1]).toContain(`name:'${item.name}'`)
      }
    }
  })

  it('allows the first release only after every source entry is implemented and reviewed', () => {
    expect(() => assertInitialEffectsReady()).not.toThrow()
  })

  it('rejects missing, unknown and incomplete source audits', () => {
    expect(() => validateInitialEffectAudits([])).toThrow()
    expect(() => validateInitialEffectAudits([{ legacyName: '不存在', cardId: 'missing', fields: {}, steps: {} }])).toThrow()
    expect(() => validateInitialEffectAudits([{ legacyName: '毕方', cardId: 'initial:bifang', fields: {}, steps: {} }])).toThrow()
  })
})

it('accepts the four audited entries while still rejecting missing fields and steps', () => {
  const audits = [
    { legacyName: '传讯', cardId: 'initial:chuanxun', fields: { effect: { kind: 'effect' as const, reference: 'play:draw' } }, steps: { effect: 'play:0:draw' } },
    { legacyName: '离火', cardId: 'initial:lihuo', fields: { effect: { kind: 'effect' as const, reference: 'play:damage-unit' } }, steps: { effect: 'play:0:damage-unit' } },
    { legacyName: '星火', cardId: 'initial:xinghuo', fields: { effect: { kind: 'effect' as const, reference: 'play:look-pick' } }, steps: { 'effect.0': 'play:0:look-pick' } },
    { legacyName: '蓄势', cardId: 'initial:xushi', fields: { effect: { kind: 'effect' as const, reference: 'play:hand-cost' } }, steps: { 'effect.0': 'play:0:hand-cost', 'effect.1': 'play:0.0:draw' } },
  ]
  expect(() => validateInitialEffectAudits(audits)).toThrow('Initial effect migration incomplete: 125 cards')
  expect(() => validateInitialEffectAudits([{ ...audits[0], fields: {} }])).toThrow('Unreviewed rules field')
  expect(() => validateInitialEffectAudits([{ ...audits[3], steps: { 'effect.0': 'play:0:hand-cost' } }])).toThrow('Unreviewed legacy step')
})
