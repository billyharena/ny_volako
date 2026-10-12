import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountDatabase } from '../data/local/database'
import { Ledger } from './ledger'
import type { ExpenseInput } from '../domain/finance'

const account = '11111111-1111-4111-8111-111111111111'
let db: AccountDatabase, ledger: Ledger
const input: ExpenseInput = { expense_date: '2026-10-11', motif: 'Courses', category_id: 'category-a', unit_price: '75', quantity: '1', extra_fee: '0' }
beforeEach(async () => {
  db = new AccountDatabase(account, crypto.randomUUID()); ledger = new Ledger(db, 'test-session')
  await db.settings.put({ user_id: account, currency: 'MGA', timezone: 'Indian/Antananarivo', locale: 'fr', theme: 'system', version: '1' })
  await db.categories.put({ id: 'category-a', user_id: account, name: 'Alimentation', icon: null, is_active: true, created_at: '2026-10-11T00:00:00Z', updated_at: '2026-10-11T00:00:00Z', version: '1', local_revision: 0 })
})
afterEach(async () => { vi.restoreAllMocks(); ledger.deactivate(); await db.delete() })

describe('transactions du carnet', () => {
  it('persiste la dépense avec son opération et conserve la chaîne de versions', async () => {
    const id = await ledger.saveExpense(input)
    let row = (await db.expenses.get(id))!
    expect(row.total).toBe('75.00')
    await ledger.saveExpense({ ...input, quantity: '2' }, id, row.local_revision)
    row = (await db.expenses.get(id))!
    await ledger.deleteExpense(id, row.local_revision)
    const operations = await db.queue.orderBy('sequence').toArray()
    expect(operations.map(row => row.kind)).toEqual(['create', 'update', 'delete'])
    expect(operations.map(row => row.base_version)).toEqual(['0', null, null])
    expect(operations[1]?.predecessor_id).toBe(operations[0]?.operation_id)
    expect(operations[2]?.predecessor_id).toBe(operations[1]?.operation_id)
    expect(operations[0]?.payload).toMatchObject({ quantity: '1.000' })
    expect((await db.expenses.get(id))?.deleted_at).not.toBeNull()
    expect((await db.expenses.get(id))?.version).toBe('0')
  })
  it('annule la dépense entière si la file ne peut pas être écrite', async () => {
    vi.spyOn(db.queue, 'add').mockRejectedValue(new DOMException('Quota exceeded', 'QuotaExceededError'))
    await expect(ledger.saveExpense(input)).rejects.toThrow()
    expect(await db.expenses.count()).toBe(0)
    expect(await db.queue.count()).toBe(0)
    expect(await db.alerts.count()).toBe(0)
  })
  it('annule également la file et la dépense si une alerte échoue', async () => {
    await ledger.saveBudget({ month_start: '2026-10-01', budget_limit: '100', warning_thresholds: [70] }, null)
    vi.spyOn(db.alerts, 'add').mockRejectedValue(new Error('Stockage indisponible'))
    await expect(ledger.saveExpense(input)).rejects.toThrow()
    expect(await db.expenses.count()).toBe(0)
    expect(await db.queue.count()).toBe(1)
    expect((await db.alertState.get('2026-10'))?.above).toEqual([])
  })
  it('rejette catégorie étrangère, catégorie désactivée et ancienne révision', async () => {
    await db.categories.put({ ...(await db.categories.get('category-a'))!, id: 'foreign', user_id: 'another-user' })
    await expect(ledger.saveExpense({ ...input, category_id: 'foreign' })).rejects.toThrow()
    const id = await ledger.saveExpense(input)
    await db.categories.update('category-a', { is_active: false })
    await expect(ledger.saveExpense(input)).rejects.toThrow()
    await ledger.saveExpense({ ...input, motif: 'Modifié' }, id, 1)
    await expect(ledger.saveExpense(input, id, 1)).rejects.toThrow('autre onglet')
    await expect(ledger.deleteExpense(id, 1)).rejects.toThrow('autre onglet')
    expect((await db.expenses.get(id))?.motif).toBe('Modifié')
  })
  it('sérialise deux modifications concurrentes sans écrasement', async () => {
    const id = await ledger.saveExpense(input)
    const results = await Promise.allSettled([ledger.saveExpense({ ...input, motif: 'A' }, id, 1), ledger.saveExpense({ ...input, motif: 'B' }, id, 1)])
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(await db.queue.count()).toBe(2)
  })
  it('conserve les données après fermeture de la connexion IndexedDB', async () => {
    const id = await ledger.saveExpense(input)
    db.close(); await db.open()
    expect((await ledger.snapshot()).expenses[0]?.id).toBe(id)
    const exported = JSON.parse(await ledger.exportRecovery()) as { operations: { entity_id: string }[] }
    expect(exported.operations[0]?.entity_id).toBe(id)
  })
  it('sépare les comptes et refuse les écritures après désactivation', async () => {
    await ledger.saveExpense(input)
    const other = new AccountDatabase('22222222-2222-4222-8222-222222222222', db.source)
    try { expect(await other.expenses.count()).toBe(0); expect(await other.queue.count()).toBe(0) } finally { await other.delete() }
    ledger.deactivate()
    await expect(ledger.saveExpense(input)).rejects.toThrow('plus actif')
    expect(await db.expenses.count()).toBe(1)
  })
  it('verrouille tous les onglets de la session avant déconnexion sans effacer les données', async () => {
    await ledger.saveExpense(input)
    const otherTab = new Ledger(db, 'test-session')
    await expect(ledger.prepareSignOut(0, true)).rejects.toThrow('sauvegarde')
    await ledger.prepareSignOut(1, true)
    await expect(otherTab.saveExpense(input)).rejects.toThrow('verrouillée')
    expect(await db.expenses.count()).toBe(1)
    await ledger.cancelSignOut()
    await otherTab.saveExpense(input)
    await ledger.prepareSignOut(2, true)
    const nextSession = new Ledger(db, 'new-session')
    await nextSession.saveExpense(input)
    expect(await db.expenses.count()).toBe(3)
  })
})

describe('budgets et alertes persistantes', () => {
  it('groupe les seuils, évite les doublons et réarme après suppression', async () => {
    await ledger.saveBudget({ month_start: '2026-10-01', budget_limit: '100', warning_thresholds: [70, 85, 100] }, null)
    const id = await ledger.saveExpense({ ...input, unit_price: '110' })
    expect((await db.alerts.toArray())[0]?.thresholds).toEqual([70, 85, 100])
    await ledger.saveExpense({ ...input, unit_price: '120' }, id, 1)
    expect(await db.alerts.count()).toBe(1)
    await ledger.deleteExpense(id, 2)
    expect((await db.alertState.get('2026-10'))?.above).toEqual([])
    await ledger.saveExpense(input)
    expect(await db.alerts.count()).toBe(2)
    const alert = (await db.alerts.toArray())[0]!
    await ledger.dismissAlert(alert.id)
    expect((await ledger.snapshot()).alerts).toHaveLength(1)
  })
  it('réarme un mois lors du déplacement d’une dépense et isole le mois suivant', async () => {
    await ledger.saveBudget({ month_start: '2026-10-01', budget_limit: '100', warning_thresholds: [70] }, null)
    await ledger.saveBudget({ month_start: '2026-11-01', budget_limit: '200', warning_thresholds: [70] }, null)
    const id = await ledger.saveExpense(input)
    await ledger.saveExpense({ ...input, expense_date: '2026-11-01' }, id, 1)
    expect((await db.alertState.get('2026-10'))?.above).toEqual([])
    expect((await db.alertState.get('2026-11'))?.above).toEqual([])
    const october = (await db.budgets.where('month_start').equals('2026-10-01').first())!
    await ledger.saveBudget({ month_start: '2026-10-01', budget_limit: '500', warning_thresholds: [70] }, october.local_revision)
    expect((await db.budgets.where('month_start').equals('2026-11-01').first())?.budget_limit).toBe('200.00')
  })
  it('n’alerte pas sans budget, évite un budget concurrent et recalcule après définition', async () => {
    await ledger.saveExpense(input)
    expect(await db.alerts.count()).toBe(0)
    await ledger.saveBudget({ month_start: '2026-10-01', budget_limit: '100', warning_thresholds: [70] }, null)
    expect(await db.alerts.count()).toBe(1)
    await expect(ledger.saveBudget({ month_start: '2026-10-01', budget_limit: '1000', warning_thresholds: [70] }, null)).rejects.toThrow()
    expect(await db.budgets.count()).toBe(1)
  })
})
