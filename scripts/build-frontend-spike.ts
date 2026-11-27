import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'

const project = fileURLToPath(new URL('../', import.meta.url))
const fixture = join(project, 'tests/acceptance/frontend-spike')
const outDir = join(project, '.tools/frontend-spike')
const legacyPage = 'quote/临界·模块化·3D版.html'
const legacy = await readFile(join(project, legacyPage))
const legacyHtml = legacy.toString('utf8')
const scripts = Array.from(legacyHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi), match => match[1])
const three = scripts.find(source => source.includes('Three.js Authors') && source.includes('REVISION'))
const legacyImages = Array.from(legacyHtml.matchAll(/data:image\/jpeg;base64,[A-Za-z0-9+/=]+/g), match => match[0])
if (!three || legacyImages.length === 0) throw new Error('The legacy page must include Three.js and embedded JPEGs')

await build({ configFile: false, root: fixture, base: './', build: { outDir, emptyOutDir: true } })
const entry = await readFile(join(fixture, 'package-entry.html'), 'utf8')
const officialEntry = entry
  .replace('<!-- THREE -->', () => `<script>${three}</script>`)
  .replace('/* LEGACY_IMAGES */ []', () => JSON.stringify(legacyImages))
const packageFile = (id: string, name: string, entryHtml: string) => JSON.stringify({
  formatVersion: 1, id, version: '0.0.1', name, protocolMajor: 1, protocolMinMinor: 0, entryHtml,
})

const officialFile = packageFile('critical.probe.official-3d', '临界官方 3D 资源样本', officialEntry)
const localFile = packageFile('third.party.frontend-probe', '第三方前端样本', entry)
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
const size = (data: string | Buffer) => ({
  bytes: Buffer.byteLength(data),
  gzipBytes: gzipSync(data).length,
  sha256: sha256(data),
})

const assetPaths = (await readdir(join(outDir, 'assets'))).map(file => `assets/${file}`).sort()
const sample = {
  source: { path: legacyPage, ...size(legacy) },
  threeBytes: Buffer.byteLength(three),
  imageReferences: legacyImages.length,
  uniqueImages: new Set(legacyImages).size,
  imageDataUrlBytes: legacyImages.reduce((bytes, url) => bytes + Buffer.byteLength(url), 0),
  officialSample: size(officialFile),
  thirdPartySample: size(localFile),
}

await Promise.all([
  writeFile(join(outDir, 'official-3d.critical-ui'), officialFile),
  writeFile(join(outDir, 'third-party.critical-ui'), localFile),
  writeFile(join(outDir, 'sample.json'), JSON.stringify(sample, null, 2) + '\n'),
  writeFile(
    join(outDir, 'service-worker.js'),
    (await readFile(join(fixture, 'service-worker.js'), 'utf8')).replace(
      '/* BUILD_ASSETS */ []',
      JSON.stringify(['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'navigation-target.html', 'sample.json', ...assetPaths]),
    ),
  ),
])
console.log(JSON.stringify(sample, null, 2))
