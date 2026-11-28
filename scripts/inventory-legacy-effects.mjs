/** Report source declarations only. This does not validate or implement effects. */
import { readFileSync, writeFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const sources = ['quote/临界·模块化·2D版.html', 'quote/临界·模块化·3D版.html']
const ignored = new Set(['name', 'attr', 'type', 'atk', 'hp', 'text'])
function readCards(path) {
  const cards = []
  for (const [index, line] of readFileSync(path, 'utf8').split('\n').entries()) {
    if (!line.trimStart().startsWith('addCard(')) continue
    runInNewContext(line, { addCard(card) { cards.push({ line: index + 1, card }) } }, { timeout: 1000 })
  }
  if (new Set(cards.map(({ card }) => card.name)).size !== cards.length) throw new Error(`Duplicate names: ${path}`)
  return cards
}
const [two, three] = sources.map(readCards)
if (two.length !== three.length || two.some(({ card }, i) => JSON.stringify(card) !== JSON.stringify(three[i].card))) {
  throw new Error('Legacy declarations differ across 2D and 3D sources; inspect before regenerating')
}
const out = [
  '# T045 旧版卡牌声明清查（未完成迁移）', '',
  '本清查仅定位两份旧版页面的声明，并非新规则定义、稳定 ID 或牌面规则核验。',
  '生成命令：`node scripts/inventory-legacy-effects.mjs`。两份页面的声明必须逐条一致，否则脚本失败。',
  '字段包括全部非展示字段，因此既包含效果入口，也包含关键词、召唤条件和次数限制；空字段不代表无需规则结算。', '',
  '| 旧卡名 | 2D 行号 | 3D 行号 | 非展示字段 |', '| --- | ---: | ---: | --- |',
]
for (const [{ card, line }, other] of two.map((value, i) => [value, three[i]])) {
  const fields = Object.keys(card).filter(key => !ignored.has(key)).map(key => `\`${key}\``).join('、') || '—'
  out.push(`| ${card.name.replaceAll('|', '\\|')} | ${line} | ${other.line} | ${fields} |`)
}
out.push('')
writeFileSync('specs/001-offline-game-refactor/legacy-effect-inventory.md', out.join('\n'))
writeFileSync('src/deck-catalog/legacy-card-sources.json', JSON.stringify(two.map(({ card, line }, i) => ({
  name: card.name, line2d: line, line3d: three[i].line,
  ruleFields: Object.keys(card).filter(key => !ignored.has(key)),
})), null, 2) + '\n')
console.log(`${two.length} matching declarations inventoried; no effects marked implemented`)
