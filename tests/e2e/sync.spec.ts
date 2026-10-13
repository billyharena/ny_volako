import { expect as baseExpect, test, type Page } from '@playwright/test'
import { registerAccount } from '../helpers/local-auth'

const expect = baseExpect.configure({ timeout: 30_000 })
async function login(page: Page, user: { email: string; password: string }) {
  await page.goto('/connexion')
  await page.getByLabel('Adresse email').fill(user.email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Mon compte', exact: true })).toBeVisible()
}
async function add(page: Page, motif: string) {
  await page.getByRole('link', { name: '+ Ajouter une dépense', exact: true }).click()
  await page.getByLabel('Motif', { exact: true }).fill(motif)
  await page.getByLabel('Catégorie', { exact: true }).selectOption({ label: 'Alimentation' })
  await page.getByLabel('Prix unitaire').fill('12,50')
  await page.getByRole('button', { name: 'Enregistrer la dépense' }).click()
  await expect(page.getByRole('link', { name: motif, exact: true })).toBeVisible()
}
async function settled(page: Page) { await expect(page.getByText('0 opération en attente', { exact: true })).toBeVisible({ timeout: 90_000 }) }
async function sync(page: Page) {
  await page.getByRole('link', { name: 'Suivre la synchronisation' }).click()
  const button = page.getByRole('button', { name: 'Synchroniser maintenant' })
  await expect(button).toBeEnabled(); await button.click()
}
async function edit(page: Page, old: string, next: string) {
  await page.getByRole('link', { name: 'Dépenses', exact: true }).click()
  await page.getByRole('link', { name: old, exact: true }).click()
  await page.getByLabel('Motif', { exact: true }).fill(next)
  await page.getByRole('button', { name: 'Enregistrer la dépense' }).click()
  await expect(page.getByRole('link', { name: next, exact: true })).toBeVisible()
}
test.describe('synchronisation réelle', () => {
  test.skip(process.env.LOCAL_AUTH_E2E !== '1', 'Supabase local requis.')
  test.setTimeout(180_000)
  test('deux appareils, conflit de modification puis suppression distante', async ({ page, context, browser }, testInfo) => {
    const user = await registerAccount(page)
    await add(page, 'Dépense commune'); await settled(page)
    const other = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
    try {
      const second = await other.newPage(); await login(second, user)
      await context.setOffline(true)
      await edit(page, 'Dépense commune', 'Choix appareil A')
      await edit(second, 'Dépense commune', 'Choix appareil B'); await settled(second)
      await context.setOffline(false); await sync(page)
      await expect(page.getByRole('heading', { name: 'Conflit à résoudre' })).toBeVisible()
      await expect(page.getByText(/Choix appareil B/)).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('conflit.png'), fullPage: true })
      await page.getByRole('button', { name: 'Proposer ma version locale' }).click()
      await page.getByRole('button', { name: 'Confirmer la résolution' }).click(); await settled(page)
      await sync(second)
      await second.getByRole('link', { name: 'Dépenses', exact: true }).click()
      await expect(second.getByRole('link', { name: 'Choix appareil A', exact: true })).toBeVisible()
      await context.setOffline(true)
      await edit(page, 'Choix appareil A', 'Edition contre suppression')
      await second.getByRole('link', { name: 'Choix appareil A', exact: true }).click()
      await second.getByRole('button', { name: 'Supprimer cette dépense' }).click()
      await second.getByRole('button', { name: 'Confirmer la suppression' }).click(); await settled(second)
      await context.setOffline(false); await sync(page)
      await expect(page.getByRole('heading', { name: 'Conflit à résoudre' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Proposer ma version locale' })).toHaveCount(0)
      await page.getByRole('button', { name: 'Choisir la version serveur' }).click()
      await page.getByRole('button', { name: 'Confirmer la résolution' }).click(); await settled(page)
      await page.getByRole('link', { name: 'Dépenses', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Aucune dépense à afficher' })).toBeVisible()
    } finally { await other.close() }
  })
  test('réponse perdue après commit, reprise et restauration sur un autre appareil', async ({ page, context, browser }, testInfo) => {
    const user = await registerAccount(page)
    let lost = false, allow = false
    const bodies: string[] = []
    await context.route('**/rest/v1/rpc/apply_change', async route => {
      bodies.push(route.request().postData()!)
      if (!lost) { lost = true; await route.fetch(); await route.abort() }
      else if (!allow) await route.abort()
      else await route.continue()
    })
    await add(page, 'Sauvegarde à reprendre')
    await expect.poll(() => lost).toBe(true)
    await page.getByRole('link', { name: 'Sauvegarde à reprendre', exact: true }).click()
    await page.getByLabel('Quantité').fill('2')
    await page.getByRole('button', { name: 'Enregistrer la dépense' }).click()
    await page.getByRole('link', { name: 'Mon compte', exact: true }).click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Exporter les données locales' }).click()
    const download = await downloadPromise, backup = testInfo.outputPath('backup.json')
    await download.saveAs(backup)
    await page.reload()
    await expect(page.getByText('2 opérations en attente', { exact: true })).toBeVisible()
    const other = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
    try {
      const second = await other.newPage(); await login(second, user)
      await second.getByLabel('Fichier de sauvegarde JSON').setInputFiles(backup)
      await second.getByRole('checkbox', { name: /Je confirme que cette sauvegarde/ }).check()
      await expect(second.getByRole('button', { name: 'Restaurer les opérations' })).toBeEnabled()
      // Attendre la fin de la lecture initiale avant une restauration exclusive.
      await second.getByRole('link', { name: 'Suivre la synchronisation' }).click()
      await expect(second.getByRole('button', { name: 'Synchroniser maintenant' })).toBeEnabled()
      await second.getByRole('link', { name: 'Mon compte', exact: true }).click()
      await second.getByLabel('Fichier de sauvegarde JSON').setInputFiles(backup)
      await second.getByRole('checkbox', { name: /Je confirme que cette sauvegarde/ }).check()
      await second.getByRole('button', { name: 'Restaurer les opérations' }).click()
      await expect(second.getByText('Sauvegarde restaurée.', { exact: false })).toBeVisible(); await settled(second)
      allow = true
      const peer = await context.newPage(); await peer.goto('/depenses')
      await sync(page); await settled(page)
      await settled(peer)
      const requestsById = new Map<string, Set<string>>()
      for (const body of bodies) {
        const id = (JSON.parse(body) as { p_operation_id: string }).p_operation_id
        requestsById.set(id, (requestsById.get(id) ?? new Set()).add(body))
      }
      expect(requestsById.size).toBe(2)
      expect([...requestsById.values()].every(bodies => bodies.size === 1)).toBe(true)
      for (const tab of [page, second, peer]) {
        await tab.getByRole('link', { name: 'Dépenses', exact: true }).click()
        await expect(tab.getByRole('link', { name: 'Sauvegarde à reprendre', exact: true })).toHaveCount(1)
        await expect(tab.getByText('Total filtré : 25,00 Ar')).toBeVisible()
      }
    } finally { await other.close() }
  })
  test('fermeture complète du navigateur avec file persistante puis reconnexion réseau', async ({ playwright }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Un seul test de profil persistant est nécessaire.')
    const profile = testInfo.outputPath('profil-persistant')
    const options = { headless: true, baseURL: 'http://127.0.0.1:4173', ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) }
    let persistent = await playwright.chromium.launchPersistentContext(profile, options)
    try {
      const page = await persistent.newPage(); await registerAccount(page)
      await persistent.setOffline(true); await add(page, 'Après fermeture complète')
      await expect(page.getByText('1 opération en attente', { exact: true })).toBeVisible()
      await persistent.close()
      persistent = await playwright.chromium.launchPersistentContext(profile, options)
      await persistent.route('**/rest/v1/rpc/apply_change', route => route.abort())
      const reopened = await persistent.newPage(); await reopened.goto('/depenses')
      await expect(reopened.getByRole('link', { name: 'Après fermeture complète', exact: true })).toBeVisible()
      await expect(reopened.getByText('1 opération en attente', { exact: true })).toBeVisible()
      await persistent.unroute('**/rest/v1/rpc/apply_change')
      await sync(reopened); await settled(reopened)
    } finally { await persistent.close() }
  })
})
