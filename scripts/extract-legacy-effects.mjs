// Extract the fixed first-release card records from both bundled legacy clients.
import { readFileSync, writeFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const files = ['quote/临界·模块化·2D版.html', 'quote/临界·模块化·3D版.html']
function extract(path) {
  const cards = []
  const lines = readFileSync(path, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('addCard(')) continue
    runInNewContext(lines[i], { addCard: card => cards.push({ card, line: i + 1 }) }, { timeout: 1000 })
  }
  return cards
}
const [two, three] = files.map(extract)
if (two.length !== 129 || three.length !== two.length) throw new Error('Legacy card count changed')
const records = two.map(({ card, line }, index) => {
  if (JSON.stringify(card) !== JSON.stringify(three[index].card)) throw new Error(`Legacy clients differ: ${card.name}`)
  return { id: `legacy:${encodeURIComponent(card.name)}`, name: card.name,
    sources: files.map((path, i) => ({ path, line: i ? three[index].line : line })), card }
})
if (new Set(records.map(x => x.id)).size !== records.length) throw new Error('Duplicate legacy card ID')
writeFileSync('src/deck-catalog/legacy-effect-inventory.json', `${JSON.stringify(records, null, 2)}\n`)
