import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin, ResolvedConfig } from 'vite'
import { defineConfig } from 'vitest/config'

const htmlVersionMarker = '__CRITICAL_HOST_BUILD_VERSION__'
const workerManifestMarker = '__CRITICAL_HOST_BUILD_MANIFEST__'

function hostShellBuild(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'critical-host-shell',
    apply: 'build',
    configResolved(resolved) {
      config = resolved
    },
    generateBundle: {
      order: 'post',
      async handler(_options, bundle) {
        const index = bundle['index.html']
        const worker = bundle['service-worker.js']
        if (index?.type !== 'asset' || typeof index.source !== 'string' || worker?.type !== 'chunk') {
          throw new Error('The host shell requires index.html and service-worker.js')
        }
        if (!index.source.includes(htmlVersionMarker) || !worker.code.includes(workerManifestMarker)) {
          throw new Error('The host shell build markers are missing')
        }

        const assets = new Map<string, string | Uint8Array>()
        if (config.publicDir) {
          const entries = await readdir(config.publicDir, { recursive: true, withFileTypes: true })
          for (const entry of entries) {
            if (!entry.isFile()) continue
            const absolute = join(entry.parentPath, entry.name)
            const output = relative(config.publicDir, absolute).split(sep).join('/')
            if (isShellAsset(output)) assets.set(output, await readFile(absolute))
          }
        }
        for (const [name, output] of Object.entries(bundle)) {
          if (isShellAsset(name)) assets.set(name, output.type === 'asset' ? output.source : output.code)
        }

        const paths = [...assets.keys()].sort()
        const integrity = () => paths.map(path => [path, 'sha256-' + createHash('sha256').update(assets.get(path)!).digest('base64')])
        const version = createHash('sha256').update(worker.code).update(JSON.stringify(integrity())).digest('hex')
        index.source = index.source.replace(htmlVersionMarker, version)
        assets.set('index.html', index.source)

        const manifest = JSON.stringify({ version, assets: integrity() })
        const markerLiteral = new RegExp(`(['"\x60])${workerManifestMarker}\\1`)
        if (!markerLiteral.test(worker.code)) throw new Error('Could not embed the host shell manifest')
        worker.code = worker.code.replace(markerLiteral, () => JSON.stringify(manifest))
      },
    },
  }
}

function isShellAsset(name: string): boolean {
  // Frontend packages are prepared separately by the launcher.
  return name !== 'service-worker.js' && !name.endsWith('.map') && !name.endsWith('.critical-ui')
}

export default defineConfig({
  base: './',
  // Unknown paths, including the worker-only package entry, keep the static 404.
  appType: 'mpa',
  plugins: [hostShellBuild()],
  build: {
    rolldownOptions: {
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        'service-worker': fileURLToPath(new URL('src/clients/service-worker.ts', import.meta.url)),
      },
      output: {
        entryFileNames: chunk => chunk.name === 'service-worker' ? 'service-worker.js' : 'assets/[name]-[hash].js',
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
