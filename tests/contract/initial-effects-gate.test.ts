import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import { assertInitialEffectsReady, initialEffectDefinitions, validateInitialEffectAudits } from '../../src/deck-catalog/effect-definitions'
import type { InitialEffectDefinition } from '../../src/deck-catalog/effect-definitions'
import sources from '../../src/deck-catalog/legacy-card-sources.json'

it('independently compares the generated inventory with both original pages', () => {
  for (const edition of ['2D', '3D'] as const) {
    const html = readFileSync(new URL(`../../quote/临界·模块化·${edition}版.html`, import.meta.url), 'utf8')
    const entries: { name: string; line: number; fields: string[] }[] = []
    for (const [index, line] of html.split('\n').entries()) {
      if (!line.trimStart().startsWith('addCard(')) continue
      runInNewContext(line, { addCard: (card: Record<string, unknown>) => entries.push({
        name: String(card.name), line: index + 1,
        fields: Object.keys(card).filter(key => !['name', 'attr', 'type', 'atk', 'hp', 'text'].includes(key)),
      }) }, { timeout: 1000 })
    }
    expect(sources).toHaveLength(129)
    expect(sources.map(row => ({ name: row.name, line: edition === '2D' ? row.line2d : row.line3d, fields: row.ruleFields })))
      .toEqual(entries)
  }
})

it.each([
  ['unrecognized trigger', { trigger: 'not-a-trigger' }, 'Unknown trigger'],
  ['unimplemented effect', { trigger: 'skill', steps: [{ type: 'not-an-effect' }] }, 'Unimplemented effect'],
  ['unknown source card', { legacyName: 'not-a-card' }, 'Unknown legacy card'],
  ['stable ID assigned to another card', { cardId: initialEffectDefinitions[1].cardId }, 'Conflicting stable ID'],
  ['another stable ID for same card', { cardId: 'different-id' }, 'Conflicting stable ID'],
])('rejects %s before reporting incomplete coverage', (_name, patch, message) => {
  const list = initialEffectDefinitions as InitialEffectDefinition[]
  list.push({ ...list[0], ...patch } as InitialEffectDefinition)
  try { expect(() => assertInitialEffectsReady()).toThrow(message) } finally { list.pop() }
})

it('rejects incomplete fields, missing mappings and unverified core references in individual audits', () => {
  const approvedDefinitions = initialEffectDefinitions.filter(item => item.cardId === 'initial:yanwen').map(({ trigger, timing, steps }) => ({ trigger, ...(timing === undefined ? {} : { timing }), steps }))
  const audit = { legacyName: '炎纹', cardId: 'initial:yanwen', approvedDefinitions, fields: {}, steps: {} } as const
  expect(() => validateInitialEffectAudits([audit])).toThrow('Unreviewed rules field')
  expect(() => validateInitialEffectAudits([{ ...audit, fields: { effect: { kind: 'effect', reference: 'play:unimplemented' } } }]))
    .toThrow('Unimplemented effect mapping')
  expect(() => validateInitialEffectAudits([{ ...audit, fields: { effect: { kind: 'core', reference: 'fake' } } }]))
    .toThrow('Unverified core rule')
  expect(() => validateInitialEffectAudits([{ ...audit, fields: { effect: { kind: 'effect', reference: '' } } }]))
    .toThrow('Missing rule reference')
  const validField = { effect: { kind: 'effect' as const, reference: 'play:damage-unit' } }
  expect(() => validateInitialEffectAudits([{ ...audit, fields: validField, steps: { 'effect.0': 'play:0:damage-unit' } }]))
    .toThrow('Unreviewed legacy step')
  expect(() => validateInitialEffectAudits([{ ...audit, fields: validField, steps: {
    'effect.0': 'play:0:damage-unit', 'effect.1': 'play:0:damage-unit' } }]))
    .toThrow('Unimplemented legacy step')
  expect(() => validateInitialEffectAudits([{ ...audit, fields: validField, steps: {
    'effect.0': 'play:0:damage-unit', 'effect.1': 'play:1:draw' } }]))
    .toThrow('Initial effect migration incomplete: 128 cards')
})

it('audits nested hand-cost continuation steps individually', () => {
  const approvedDefinitions = initialEffectDefinitions.filter(item => item.cardId === 'initial:fenghuoling').map(({ trigger, timing, steps }) => ({ trigger, ...(timing === undefined ? {} : { timing }), steps }))
  const audit = { legacyName: '烽火令', cardId: 'initial:fenghuoling', approvedDefinitions,
    fields: { effect: { kind: 'effect' as const, reference: 'play:hand-cost' } }, steps: {} }
  expect(() => validateInitialEffectAudits([{ ...audit, steps: { 'effect.0': 'play:0:hand-cost' } }]))
    .toThrow('Unreviewed legacy step')
  expect(() => validateInitialEffectAudits([{ ...audit, steps: {
    'effect.0': 'play:0:hand-cost', 'effect.1': 'play:0.0:draw' } }]))
    .toThrow('Unimplemented legacy step')
  expect(() => validateInitialEffectAudits([{ ...audit, steps: {
    'effect.0': 'play:0:hand-cost', 'effect.1': 'play:0:hand-cost' } }]))
    .toThrow('Unimplemented legacy step')
  expect(() => validateInitialEffectAudits([{ ...audit, steps: {
    'effect.0': 'play:0:hand-cost', 'effect.1': 'play:0.0:search-deck' } }]))
    .toThrow('Initial effect migration incomplete: 128 cards')
})
