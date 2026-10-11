import { randomUUID } from 'node:crypto'
import { expect as baseExpect, test, type Page } from '@playwright/test'

// Auth + SMTP locaux peuvent dépasser 5 s sur Docker Desktop au premier appel.
const expect = baseExpect.configure({ timeout: 20_000 })

// Ces tests n'utilisent que Supabase et Mailpit locaux, jamais le projet hébergé.
test.describe('Auth et RPC sur Supabase local', () => {
  test.skip(process.env.LOCAL_AUTH_E2E !== '1', 'Démarrer Supabase local et compiler avec ses paramètres publics.')
  test.setTimeout(120_000)

  async function emailLink(page: Page, email: string, subject: string) {
    let messageId = ''
    await expect.poll(async () => {
      const response = await page.request.get('http://127.0.0.1:54324/api/v1/messages')
      const inbox = await response.json() as { messages: { ID: string; Subject: string; To: { Address: string }[] }[] }
      messageId = inbox.messages.find(message => message.To.some(to => to.Address === email) && message.Subject.includes(subject))?.ID ?? ''
      return messageId
    }, { timeout: 30_000 }).not.toBe('')
    const response = await page.request.get(`http://127.0.0.1:54324/api/v1/message/${messageId}`)
    const message = await response.json() as { Text: string; HTML: string }
    const link = (message.Text || message.HTML).match(/http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify[^\s<>"\]]+/)?.[0]?.replace(/&amp;/g, '&')
    expect(link).toBeTruthy()
    return link!
  }

  test('confirmation, session persistante, RPC concurrentes et récupération', async ({ page }, testInfo) => {
    const email = `browser-${randomUUID()}@example.test`
    const password = `Nv!${randomUUID()}`
    await page.goto('/inscription')
    await page.getByLabel('Adresse email').fill(email)
    await page.getByLabel('Mot de passe', { exact: true }).fill(password)
    await page.getByLabel('Confirmer le mot de passe').fill(password)
    await page.getByRole('button', { name: 'Créer mon compte' }).click()
    await expect(page.getByRole('status')).toContainText('email de confirmation')
    await page.goto(await emailLink(page, email, 'Confirm'))
    await expect(page.getByRole('heading', { name: 'Mon compte', exact: true })).toBeVisible()
    await expect(page.getByRole('status')).toContainText('Votre compte est prêt')
    await page.reload()
    await expect(page.getByRole('status')).toContainText('Votre compte est prêt')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('compte.png'), fullPage: true })

    // Le secret de session reste dans le navigateur ; seules les réponses métier reviennent au test.
    const protocol = await page.evaluate(async (publicKey) => {
      if (!publicKey) throw new Error('Clé publique locale absente')
      const key = Object.keys(localStorage).find(key => key.endsWith('-auth-token'))
      if (!key) throw new Error('Session locale absente')
      const session = JSON.parse(localStorage.getItem(key)!) as { access_token: string }
      const rpc = async (name: string, args: Record<string, unknown>) => {
        const response = await fetch(`http://127.0.0.1:54321/rest/v1/rpc/${name}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: publicKey }, body: JSON.stringify(args),
        })
        if (!response.ok) throw new Error(`RPC ${name}: ${response.status}`)
        return await response.json() as Record<string, unknown>
      }
      const create = { p_operation_id: crypto.randomUUID(), p_entity: 'categories', p_entity_id: crypto.randomUUID(), p_kind: 'create', p_base_version: '0', p_payload: { name: 'Concurrence' } }
      const duplicates = await Promise.all([rpc('apply_change', create), rpc('apply_change', create)])
      const update = { ...create, p_kind: 'update', p_base_version: '1' }
      const races = await Promise.all([
        rpc('apply_change', { ...update, p_operation_id: crypto.randomUUID(), p_payload: { name: 'Appareil A' } }),
        rpc('apply_change', { ...update, p_operation_id: crypto.randomUUID(), p_payload: { name: 'Appareil B' } }),
      ])
      return { sameReceipt: JSON.stringify(duplicates[0]) === JSON.stringify(duplicates[1]), statuses: races.map(result => result.status).sort() }
    }, process.env.VITE_SUPABASE_PUBLISHABLE_KEY)
    expect(protocol).toEqual({ sameReceipt: true, statuses: ['applied', 'conflict'] })

    await page.getByRole('button', { name: 'Se déconnecter de cet appareil' }).click()
    await expect(page.getByRole('heading', { name: 'Heureux de vous retrouver.' })).toBeVisible()
    await page.goto('/compte')
    await expect(page.getByRole('heading', { name: 'Heureux de vous retrouver.' })).toBeVisible()
    await page.getByRole('link', { name: 'Mot de passe oublié ?' }).click()
    await page.getByLabel('Adresse email').fill(email)
    await page.getByRole('button', { name: 'Recevoir un lien' }).click()
    await expect(page.getByRole('status')).toContainText('Si un compte correspond')
    await page.goto(await emailLink(page, email, 'Reset'))
    await expect(page.getByRole('heading', { name: 'Un nouveau mot de passe.' })).toBeVisible()
    const replacement = `Nv!${randomUUID()}`
    await page.getByLabel('Mot de passe', { exact: true }).fill(replacement)
    await page.getByLabel('Confirmer le mot de passe').fill(replacement)
    await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click()
    await expect(page.getByRole('heading', { name: 'Mon compte', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Se déconnecter de cet appareil' }).click()
    await page.getByLabel('Adresse email').fill(email)
    await page.getByLabel('Mot de passe', { exact: true }).fill(replacement)
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page.getByRole('status')).toContainText('Votre compte est prêt')
  })
})
