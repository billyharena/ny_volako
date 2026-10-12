import { randomUUID } from 'node:crypto'
import { expect, type Page } from '@playwright/test'

export async function emailLink(page: Page, email: string, subject: string) {
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

export async function registerAccount(page: Page) {
  const email = `ledger-${randomUUID()}@example.test`, password = `Nv!${randomUUID()}`
  await page.goto('/inscription')
  await page.getByLabel('Adresse email').fill(email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(password)
  await page.getByLabel('Confirmer le mot de passe').fill(password)
  await page.getByRole('button', { name: 'Créer mon compte' }).click()
  await expect(page.getByRole('status')).toContainText('email de confirmation', { timeout: 20_000 })
  await page.goto(await emailLink(page, email, 'Confirm'))
  await expect(page.getByRole('status')).toContainText('Votre compte est prêt', { timeout: 20_000 })
  return { email, password }
}
