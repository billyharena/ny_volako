import type { AccountDatabase, SyncedRow } from '../data/local/database'
import { decodeBudget, decodeCategory, decodeExpense } from '../data/remote/bootstrap'
import type { Entity } from '../domain/finance'
import type { Json } from '../data/remote/database.types'

export const keyOf = (entity: Entity, id: string) => `${entity}:${id}`
export const tableOf = (db: AccountDatabase, entity: Entity) => entity === 'expenses' ? db.expenses : entity === 'categories' ? db.categories : db.budgets
export function decodeRow(entity: Entity, raw: unknown, userId: string): SyncedRow {
  return entity === 'expenses' ? decodeExpense(raw, userId) : entity === 'categories' ? decodeCategory(raw, userId) : decodeBudget(raw, userId)
}
export function payloadOf(entity: Entity, row: SyncedRow): Json {
  if (entity === 'expenses' && 'motif' in row) return { expense_date: row.expense_date, motif: row.motif, category_id: row.category_id, unit_price: row.unit_price, quantity: row.quantity, extra_fee: row.extra_fee }
  if (entity === 'categories' && 'name' in row) return { name: row.name, icon: row.icon, is_active: row.is_active }
  if (entity === 'monthly_budgets' && 'month_start' in row) return { month_start: row.month_start, budget_limit: row.budget_limit, warning_thresholds: row.warning_thresholds }
  throw new Error('Type de donnée incohérent.')
}
export function putRow(db: AccountDatabase, entity: Entity, row: SyncedRow) {
  if (entity === 'expenses' && 'motif' in row) return db.expenses.put(row)
  if (entity === 'categories' && 'name' in row) return db.categories.put(row)
  if (entity === 'monthly_budgets' && 'month_start' in row) return db.budgets.put(row)
  throw new Error('Type de donnée incohérent.')
}
