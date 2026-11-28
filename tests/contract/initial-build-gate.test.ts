import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it('blocks the initial-release command while full audit coverage is absent', () => {
  const result = spawnSync('npm', ['run', 'build:initial'], { cwd: process.cwd(), encoding: 'utf8' })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('Initial effect migration incomplete: 129 cards')
})

it('rejects tampering with a source page or generated inventory in an isolated copy', () => {
  const directory = mkdtempSync(join(tmpdir(), 'effect-source-gate-'))
  try {
    for (const path of ['quote', 'scripts', 'src/deck-catalog', 'specs/001-offline-game-refactor']) {
      cpSync(path, join(directory, path), { recursive: true })
    }
    const check = () => spawnSync('node', ['scripts/inventory-legacy-effects.mjs', '--check'], { cwd: directory, encoding: 'utf8' })
    expect(check().status).toBe(0)
    const page = join(directory, 'quote/临界·模块化·2D版.html')
    const originalPage = readFileSync(page, 'utf8')
    writeFileSync(page, originalPage.replace("name:'毕方'", "name:'毕方改动'"))
    expect(check().status).not.toBe(0)
    writeFileSync(page, originalPage)
    const inventory = join(directory, 'src/deck-catalog/legacy-card-sources.json')
    writeFileSync(inventory, readFileSync(inventory, 'utf8').replace('毕方', '篡改'))
    expect(check().status).not.toBe(0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
