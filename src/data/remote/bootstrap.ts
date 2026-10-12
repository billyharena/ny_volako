import type { AppClient } from './client'
import type { AccountDatabase } from '../local/database'
import { budgetState, sumExpenses, validateBudget, validateExpense, type Budget, type Category, type Expense, type RecordBase, type Settings } from '../../domain/finance'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Réponse serveur invalide.')
  return value as Record<string, unknown>
}
function string(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') throw new Error('Réponse serveur invalide.')
  return value
}
function uuid(row: Record<string, unknown>, key: string): string {
  const value = string(row, key)
  if (!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)) throw new Error('Identifiant serveur invalide.')
  return value
}
function owner(row: Record<string, unknown>, userId: string) {
  if (row.user_id !== userId) throw new Error('Les données reçues ne correspondent pas à ce compte.')
  const version = string(row, 'version')
  if (!/^[1-9]\d*$/.test(version)) throw new Error('Version serveur invalide.')
  return { user_id: userId, version }
}
function base(row: Record<string, unknown>, userId: string): RecordBase {
  const created_at = string(row, 'created_at'), updated_at = string(row, 'updated_at')
  if (!Number.isFinite(Date.parse(created_at)) || !Number.isFinite(Date.parse(updated_at))) throw new Error('Horodatage serveur invalide.')
  return { ...owner(row, userId), id: uuid(row, 'id'), created_at, updated_at, local_revision: 0 }
}
export function decodeSettings(value: unknown, userId: string): Settings {
  const row = object(value)
  const currency = string(row, 'currency'), timezone = string(row, 'timezone'), theme = string(row, 'theme'), locale = string(row, 'locale')
  if (!/^[A-Z]{3}$/.test(currency) || !['light', 'dark', 'system'].includes(theme) || locale !== 'fr') throw new Error('Paramètres serveur invalides.')
  new Intl.DateTimeFormat('fr', { timeZone: timezone }).format()
  return { ...owner(row, userId), currency, timezone, theme, locale }
}
export function decodeCategory(value: unknown, userId: string): Category {
  const row = object(value), name = string(row, 'name')
  if (!name.trim() || [...name].length > 80 || typeof row.is_active !== 'boolean' || (row.icon !== null && !['shopping-basket','bus','house','heart-pulse','coffee','ellipsis'].includes(String(row.icon)))) throw new Error('Catégorie serveur invalide.')
  return { ...base(row, userId), name, icon: row.icon as string | null, is_active: row.is_active }
}
export function decodeExpense(value: unknown, userId: string): Expense {
  const row = object(value)
  const fields = validateExpense({ expense_date: string(row, 'expense_date'), motif: string(row, 'motif'), category_id: uuid(row, 'category_id'), unit_price: string(row, 'unit_price'), quantity: string(row, 'quantity'), extra_fee: string(row, 'extra_fee') })
  if (fields.total !== row.total || (row.deleted_at !== null && (typeof row.deleted_at !== 'string' || !Number.isFinite(Date.parse(row.deleted_at))))) throw new Error('Dépense serveur invalide.')
  return { ...base(row, userId), ...fields, deleted_at: row.deleted_at as string | null }
}
export function decodeBudget(value: unknown, userId: string): Budget {
  const row = object(value)
  if (!Array.isArray(row.warning_thresholds) || row.warning_thresholds.some(n => typeof n !== 'number')) throw new Error('Seuils serveur invalides.')
  return { ...base(row, userId), ...validateBudget({ month_start: string(row, 'month_start'), budget_limit: string(row, 'budget_limit'), warning_thresholds: row.warning_thresholds as number[] }) }
}

export async function initializeLocalAccount(db: AccountDatabase, client: AppClient, signal: AbortSignal) {
  if (await db.metadata.get('initialized')) return
  const { data: initial, error } = await client.rpc('initialize_account').abortSignal(signal)
  if (error) throw new Error('Première ouverture : connectez-vous à Internet pour préparer les données du compte.')
  const settings = decodeSettings(initial, db.userId)
  async function pages<T extends { id: string }>(entity: string, decode: (value: unknown, owner: string) => T): Promise<T[]> {
    const result: T[] = []
    let after: string | undefined
    for (;;) {
      signal.throwIfAborted()
      const { data, error } = await client.rpc('read_account_page', { p_entity: entity, p_limit: 500, ...(after ? { p_after: after } : {}) }).abortSignal(signal)
      if (error || !Array.isArray(data)) throw new Error('Impossible de préparer les données locales. Réessayez sans fermer votre compte.')
      const rows = data.map(value => decode(value, db.userId))
      for (const row of rows) {
        if (after && row.id <= after) throw new Error('Pagination serveur invalide.')
        after = row.id
        result.push(row)
      }
      if (rows.length < 500) return result
    }
  }
  const [categories, expenses, budgets] = await Promise.all([pages('categories', decodeCategory), pages('expenses', decodeExpense), pages('monthly_budgets', decodeBudget)])
  const categoryIds = new Set(categories.map(category => category.id))
  if (expenses.some(expense => !categoryIds.has(expense.category_id))) throw new Error('Des catégories manquent. Réessayez la préparation.')
  signal.throwIfAborted()
  await db.transaction('rw', db.tables, async () => {
    if (await db.metadata.get('initialized')) return
    if (await db.queue.count()) throw new Error('Des opérations locales existent déjà. Aucune donnée n’a été remplacée.')
    await db.categories.bulkPut(categories)
    await db.expenses.bulkPut(expenses)
    await db.budgets.bulkPut(budgets)
    await db.settings.put(settings)
    for (const budget of budgets) {
      const month = budget.month_start.slice(0, 7)
      await db.alertState.put({ month, above: budgetState(sumExpenses(expenses.filter(row => row.expense_date.startsWith(`${month}-`))), budget)?.crossed ?? [] })
    }
    await db.metadata.put({ key: 'initialized', value: new Date().toISOString() })
    signal.throwIfAborted()
  })
}
