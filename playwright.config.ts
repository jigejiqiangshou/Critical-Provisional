import { defineConfig } from '@playwright/test'

const host = '127.0.0.1'
const port = process.env.PLAYWRIGHT_PREVIEW_PORT ?? '4173'
if (!/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65_535) {
  throw new Error('PLAYWRIGHT_PREVIEW_PORT must be a decimal port from 1 to 65535')
}
const baseURL = `http://${host}:${port}`

export default defineConfig({
  testDir: './tests/acceptance',
  testMatch: '**/*.spec.ts',
  use: { baseURL },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `npm run build && npm run preview -- --host ${host} --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGINT', timeout: 5000 },
  },
})
