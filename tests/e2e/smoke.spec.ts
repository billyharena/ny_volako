import { expect, test } from '@playwright/test'

test('le build démarre, navigue et recharge une route directe', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
  await expect(page).toHaveTitle('Ny Volako · Mes dépenses, simplement')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Un peu plus de clarté')
  await expect(page.getByText(/Les dépenses sont enregistrées sur votre appareil/)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('accueil.png'), fullPage: true })
  await page.getByRole('link', { name: 'Voir la configuration' }).click()
  await expect(page).toHaveURL(/\/configuration$/)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Configuration' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(errors).toEqual([])
})

test('navigation clavier et page introuvable', async ({ page }) => {
  await page.goto('/page-absente')
  await expect(page.getByRole('heading', { name: 'Reprenons par l’accueil.' })).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Aller au contenu' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
  await page.getByRole('link', { name: 'Retour à l’accueil' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Un peu plus de clarté')
})
