import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

// Extract the declarations independently from the retained original pages. More
// than one addCard call can occur on a single line (e.g. 归根 and 汇流).
type LegacyCard = Record<string, unknown> & { name: string }
function cardsFrom(edition: '2D' | '3D'): LegacyCard[] {
  const html = readFileSync(new URL(`../../quote/临界·模块化·${edition}版.html`, import.meta.url), 'utf8')
  const declarations = html.split('\n').filter(line => line.trimStart().startsWith('addCard(')).join('\n')
  const cards: LegacyCard[] = []
  runInNewContext(declarations, { addCard: (card: LegacyCard) => cards.push(card) }, { timeout: 1000 })
  return JSON.parse(JSON.stringify(cards)) as LegacyCard[]
}

describe('retained legacy effect sources', () => {
  it('extracts every declaration, including multiple calls on one line, in both editions', () => {
    const two = cardsFrom('2D')
    const three = cardsFrom('3D')
    expect(two).toHaveLength(129)
    expect(new Set(two.map(card => card.name)).size).toBe(129)
    expect(three).toEqual(two)
    expect(two.map(card => card.name)).toEqual(expect.arrayContaining(['归根', '汇流', '探珠', '朱雀·陵光']))
  })

  it('retains multiple independent rule entry kinds on the same card', () => {
    const cards = cardsFrom('2D')
    const flagship = cards.find(card => card.name === '朱雀·陵光')!
    expect(flagship).toHaveProperty('skill')
    expect(flagship).toHaveProperty('enter')
    expect(flagship).toHaveProperty('divine')
    const aggregate = Object.fromEntries(['effect', 'skill', 'enter', 'deathrattle', 'onEvent', 'trap', 'passive', 'divine']
      .map(key => [key, cards.filter(card => card[key] != null).length]))
    expect(aggregate).toEqual({ effect: 68, skill: 16, enter: 12, deathrattle: 4, onEvent: 2, trap: 13, passive: 11, divine: 5 })
  })
})
