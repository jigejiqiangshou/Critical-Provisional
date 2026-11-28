import { createServer } from 'vite'

// Vite resolves the versioned ruleset's ?raw artifacts exactly as in the app.
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { assertInitialEffectsReady } = await server.ssrLoadModule('/src/deck-catalog/effect-definitions.ts')
  assertInitialEffectsReady()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await server.close()
}
