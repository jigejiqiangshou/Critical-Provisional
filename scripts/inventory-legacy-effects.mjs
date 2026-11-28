/** Report source declarations only. This does not validate or implement effects. */
import { readFileSync, writeFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createHash } from 'node:crypto'

const checkOnly = process.argv.includes('--check')
function output(path, contents) {
  if (checkOnly) {
    if (readFileSync(path, 'utf8') !== contents) throw new Error(`Stale legacy source inventory: ${path}`)
  } else writeFileSync(path, contents)
}

const sources = ['quote/临界·模块化·2D版.html', 'quote/临界·模块化·3D版.html']
const facesPath = 'quote/临界卡池与构筑.html'
const ignored = new Set(['name', 'attr', 'type', 'atk', 'hp', 'text'])
function readCards(path) {
  const cards = []
  const text = readFileSync(path, 'utf8')
  for (const [index, line] of text.split('\n').entries()) {
    if (!line.trimStart().startsWith('addCard(')) continue
    runInNewContext(line, { addCard(card) { cards.push({ line: index + 1, card }) } }, { timeout: 1000 })
  }
  if ((text.match(/\baddCard\s*\(/g) ?? []).length !== cards.length + 1) throw new Error(`Unparsed card declaration: ${path}`)
  if (new Set(cards.map(({ card }) => card.name)).size !== cards.length) throw new Error(`Duplicate names: ${path}`)
  return cards
}
const [two, three] = sources.map(readCards)
const facesText = readFileSync(facesPath, 'utf8')
const faces = []
for (const [i, line] of facesText.split('\n').entries()) {
  const match = line.match(/<div class="card(?: [^"]*)?">[^\n]*?<div class="name">([^<]+)<\/div>[^\n]*?<div class="text">([^<]*)<\/div>/)
  if (match) faces.push({ name: match[1], text: match[2], line: i + 1 })
}
if ((facesText.match(/<div class="card(?: [^"]*)?">/g) ?? []).length !== faces.length ||
    new Set(faces.map(face => face.name)).size !== faces.length) throw new Error('Unparsed or duplicate card face')
const facesByName = new Map(faces.map(face => [face.name, face]))
if (faces.length !== two.length || two.some(({ card }) => facesByName.get(card.name)?.text !== card.text)) {
  throw new Error('Legacy card faces differ from game declarations; inspect before regenerating')
}
if (two.length !== three.length || two.some(({ card }, i) => JSON.stringify(card) !== JSON.stringify(three[i].card))) {
  throw new Error('Legacy declarations differ across 2D and 3D sources; inspect before regenerating')
}
function sourceSteps(card) {
  const steps = []
  function visit(value, path) {
    if (!value || typeof value !== 'object') return
    if (!Array.isArray(value) && typeof value.type === 'string') steps.push({ path, type: value.type })
    for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`)
  }
  for (const [key, value] of Object.entries(card)) if (!ignored.has(key)) visit(value, key)
  return steps
}
const out = [
  '# T045 旧版卡牌声明清查（未完成迁移）', '',
  '本清查仅定位两份旧版页面的声明，并非新规则定义、稳定 ID 或牌面规则核验。',
  '生成命令：`node scripts/inventory-legacy-effects.mjs`。两份页面的声明及卡池牌面必须逐条一致，否则脚本失败。',
  '字段包括全部非展示字段，因此既包含效果入口，也包含关键词、召唤条件和次数限制；空字段不代表无需规则结算。', '',
  '| 旧卡名 | 2D 行号 | 3D 行号 | 非展示字段 |', '| --- | ---: | ---: | --- |',
]
for (const [{ card, line }, other] of two.map((value, i) => [value, three[i]])) {
  const fields = Object.keys(card).filter(key => !ignored.has(key)).map(key => `\`${key}\``).join('、') || '—'
  out.push(`| ${card.name.replaceAll('|', '\\|')} | ${line} | ${other.line} | ${fields} |`)
}
out.push('')
output('specs/001-offline-game-refactor/legacy-effect-inventory.md', out.join('\n'))
output('src/deck-catalog/legacy-card-sources.json', JSON.stringify(two.map(({ card, line }, i) => ({
  name: card.name, line2d: line, line3d: three[i].line, faceLine: facesByName.get(card.name).line, faceText: card.text,
  ruleFields: Object.keys(card).filter(key => !ignored.has(key)), sourceSteps: sourceSteps(card),
})), null, 2) + '\n')
output('src/deck-catalog/legacy-source-hashes.json', JSON.stringify(Object.fromEntries([...sources, facesPath].map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])), null, 2) + '\n')
console.log(`${two.length} matching declarations inventoried`)
