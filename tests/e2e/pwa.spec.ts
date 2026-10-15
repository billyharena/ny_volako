import { expect, test } from '@playwright/test'

test('manifeste, précache public et navigation hors ligne', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  const manifest = await (await page.request.get('/manifest.webmanifest')).json()
  expect(manifest).toMatchObject({ name: 'Ny Volako · Mon carnet de dépenses', lang: 'fr', start_url: '/', display: 'standalone' })
  expect(manifest.icons).toHaveLength(3)
  for (const icon of manifest.icons) expect((await page.request.get(icon.src)).ok()).toBe(true)
  await context.setOffline(true)
  await page.goto('/configuration')
  await expect(page.getByRole('heading', { name: 'Configuration', exact: true })).toBeVisible()
  await page.getByText('Installer et utiliser hors ligne', { exact: true }).click()
  await expect(page.getByText('Application prête à démarrer hors ligne sur cet appareil.')).toBeVisible()
  const urls = await page.evaluate(async () => {
    const keys = (await caches.keys()).filter(key => key.startsWith('ny-volako-shell-'))
    return (await Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).map(request => request.url)))).flat()
  })
  expect(urls.length).toBeGreaterThan(10)
  expect(urls.every(url => { const value = new URL(url); return value.origin === 'http://127.0.0.1:4173' && !value.search && /\.(js|css|html|svg|png|webmanifest)$/.test(value.pathname) })).toBe(true)
})

test('formats étroit, tablette et bureau sans débordement', async ({ page }, testInfo) => {
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/connexion')
    await page.getByText('Installer et utiliser hors ligne', { exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`installation-${width}.png`), fullPage: true })
  }
})
