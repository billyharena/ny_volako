/* global caches, document, innerWidth */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'

// Read-only checks: never create users or financial records in production.
const origin = new URL(process.env.DEPLOYMENT_URL ?? '').origin
assert.equal(new URL(origin).protocol, 'https:')
const api = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
assert.ok(api && key, 'Provide the expected public Supabase configuration')
const result = { origin, routes: [], anonymousAccessDenied: [], browserErrors: [] }
const headers = { apikey: key, 'Content-Type': 'application/json' }
async function request(url, options = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await fetch(url, { ...options, signal: AbortSignal.timeout(20000) }) }
    catch (error) {
      if (attempt === 2) throw error
      console.log(`Retry ${attempt + 1}: ${new URL(url).pathname}`)
    }
  }
}

for (const route of ['/', '/connexion', '/recuperation', '/depenses', '/configuration']) {
  const response = await request(origin + route)
  assert.equal(response.status, 200, route)
  assert.match(response.headers.get('content-type'), /text\/html/)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.match(response.headers.get('cache-control'), /max-age=0/)
  result.routes.push(route)
}
const worker = await request(origin + '/sw.js')
assert.equal(worker.status, 200)
assert.match(worker.headers.get('content-type'), /javascript/)
assert.match(worker.headers.get('cache-control'), /no-store/)
const manifest = await (await request(origin + '/manifest.webmanifest')).json()
assert.equal(manifest.display, 'standalone')
for (const icon of manifest.icons) {
  const response = await request(new URL(icon.src, origin))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/png')
}
for (const table of ['user_settings', 'categories', 'expenses', 'monthly_budgets', 'sync_receipts']) {
  const response = await request(`${api}/rest/v1/${table}?select=*&limit=1`, { headers })
  assert.ok([401, 403].includes(response.status), `Anonymous access: ${table} (${response.status})`)
  result.anonymousAccessDenied.push(table)
}
const rpc = await request(`${api}/rest/v1/rpc/initialize_account`, { method: 'POST', headers, body: '{}' })
assert.ok([401, 403].includes(rpc.status), 'Anonymous RPC must be denied')
const auth = await request(`${api}/auth/v1/settings`, { headers })
assert.equal(auth.status, 200)
const settings = await auth.json()
result.emailAuthEnabled = settings.external?.email
result.emailConfirmationRequired = !settings.mailer_autoconfirm

await mkdir('test-results/deployment', { recursive: true })
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  page.on('pageerror', error => result.browserErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') result.browserErrors.push(message.text()) })
  await page.goto(origin + '/connexion')
  await page.getByRole('button', { name: 'Se connecter', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Se connecter', exact: true }).isEnabled(), true)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
  })
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(request => request.url)))).flat())
  assert.ok(cached.length > 10)
  assert.ok(cached.every(url => new URL(url).origin === origin), 'Only application shell assets may be cached')
  assert.ok(cached.every(url => !/\/auth\/|\/rest\//.test(url)))
  result.cachedAssets = cached.length
  await context.setOffline(true)
  await page.goto(origin + '/configuration')
  await page.getByRole('heading', { name: 'Configuration', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: 'test-results/deployment/mobile-offline.png', fullPage: true })
  result.offlineNavigation = true
  await context.setOffline(false)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(origin)
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.screenshot({ path: 'test-results/deployment/desktop.png', fullPage: true })
  assert.deepEqual(result.browserErrors, [])
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
}
