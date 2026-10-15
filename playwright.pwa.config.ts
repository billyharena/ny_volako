import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests/pwa', outputDir: './test-results/pwa', workers: 1, timeout: 150_000,
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) },
  webServer: { command: 'node scripts/pwa-test-server.mjs', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
})
