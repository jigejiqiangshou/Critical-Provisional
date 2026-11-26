import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))
const publicAssets = ['manifest.webmanifest', 'storage-192.png', 'storage-512.png']
const serviceWorker = readFileSync(resolve(root, 'service-worker.js'), 'utf8')

export default defineConfig({
  root,
  base: './',
  worker: { format: 'es' },
  build: {
    outDir: resolve(root, '../../../dist/storage-spike'),
    emptyOutDir: true,
  },
  plugins: [{
    name: 'storage-spike-offline-assets',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const hash = createHash('sha256').update(serviceWorker)
        const files = Object.keys(bundle).sort()
        for (const file of files) {
          const asset = bundle[file]
          hash.update(file).update(asset.type === 'asset' ? asset.source : asset.code)
        }
        for (const file of publicAssets) {
          hash.update(file).update(readFileSync(resolve(root, 'public', file)))
        }

        this.emitFile({
          type: 'asset',
          fileName: 'storage-spike-sw.js',
          source: serviceWorker
            .replace('__BUILD_HASH__', JSON.stringify(hash.digest('hex')))
            .replace('__PRECACHE_FILES__', JSON.stringify([...files, ...publicAssets])),
        })
      },
    },
  }],
})
