export type Entity = 'categories' | 'expenses' | 'monthly_budgets'
export type RecordBase = { id: string; user_id: string; version: string; created_at: string; updated_at: string; local_revision: number }
export type Category = RecordBase & { name: string; icon: string | null; is_active: boolean }
export type ExpenseInput = { expense_date: string; motif: string; category_id: string; unit_price: string; quantity: string; extra_fee: string }
export type Expense = RecordBase & ExpenseInput & { total: string; deleted_at: string | null }
export type BudgetInput = { month_start: string; budget_limit: string; warning_thresholds: number[] }
export type Budget = RecordBase & BudgetInput
export type Settings = { user_id: string; currency: string; timezone: string; locale: string; theme: string; version: string }
export type Alert = { id: string; month: string; thresholds: number[]; created_at: string; dismissed: boolean }
export type Snapshot = { categories: Category[]; expenses: Expense[]; budgets: Budget[]; settings: Settings; pending: number; alerts: Alert[]; pendingIds?: string[] }

export class ValidationError extends Error {
  constructor(public readonly fields: Record<string, string>) { super(Object.values(fields)[0] ?? 'Valeur invalide.') }
}

export function decimal(value: string, scale: number, integerDigits: number, positive = false): bigint {
  const normalized = value.trim().replace(',', '.')
  if (!new RegExp(`^(0|[1-9][0-9]{0,${integerDigits - 1}})(\\.[0-9]{1,${scale}})?$`).test(normalized)) throw new Error('Nombre invalide.')
  const [whole = '0', fraction = ''] = normalized.split('.')
  const result = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0'))
  if (positive && result === 0n) throw new Error('La valeur doit être supérieure à zéro.')
  return result
}
export function fixed(value: bigint, scale = 2): string {
  const sign = value < 0n ? '-' : ''
  const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, '0')
  return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`
}
export function cents(value: string): bigint {
  if (!/^-?\d+\.\d{2}$/.test(value)) throw new Error('Montant canonique invalide.')
  return BigInt(value.replace('.', ''))
}
export function total(unitPrice: string, quantity: string, extraFee: string): string {
  const price = decimal(unitPrice, 2, 12)
  const units = decimal(quantity, 3, 7, true)
  const fee = decimal(extraFee, 2, 12)
  return fixed((price * units + 500n) / 1000n + fee)
}
export function money(value: string | bigint, currency = 'MGA'): string {
  const amount = typeof value === 'bigint' ? value : cents(value)
  const absolute = amount < 0n ? -amount : amount
  const whole = new Intl.NumberFormat('fr-FR').format(absolute / 100n)
  const fraction = (absolute % 100n).toString().padStart(2, '0')
  return `${amount < 0n ? '−' : ''}${whole},${fraction} ${currency === 'MGA' ? 'Ar' : currency}`
}
export function validDate(value: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') return false
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}
export function today(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function dayInZone(timezone: string, date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const get = (type: string) => parts.find(part => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}
export function validateExpense(input: ExpenseInput): ExpenseInput & { total: string } {
  const fields: Record<string, string> = {}
  if (!validDate(input.expense_date)) fields.expense_date = 'Choisissez une date valide entre 1900 et 9999.'
  const motif = input.motif.trim()
  if (!motif || [...motif].length > 240) fields.motif = 'Indiquez un motif de 1 à 240 caractères.'
  if (!input.category_id) fields.category_id = 'Choisissez une catégorie.'
  const parsed: Record<string, string> = {}
  for (const field of ['unit_price', 'quantity', 'extra_fee'] as const) {
    try { parsed[field] = fixed(decimal(input[field], field === 'quantity' ? 3 : 2, field === 'quantity' ? 7 : 12, field === 'quantity'), field === 'quantity' ? 3 : 2) }
    catch { fields[field] = field === 'quantity' ? 'Quantité positive, 7 chiffres entiers et 3 décimales maximum.' : 'Montant positif ou nul, 12 chiffres entiers et 2 décimales maximum.' }
  }
  if (Object.keys(fields).length) throw new ValidationError(fields)
  const normalized = { ...input, motif, unit_price: parsed.unit_price!, quantity: parsed.quantity!, extra_fee: parsed.extra_fee! }
  return { ...normalized, total: total(normalized.unit_price, normalized.quantity, normalized.extra_fee) }
}
export function validateBudget(input: BudgetInput): BudgetInput {
  const fields: Record<string, string> = {}
  if (!validDate(input.month_start) || !input.month_start.endsWith('-01')) fields.month_start = 'Choisissez un mois valide.'
  let limit = ''
  try { limit = fixed(decimal(input.budget_limit, 2, 12, true)) } catch { fields.budget_limit = 'Budget strictement positif, 12 chiffres entiers et 2 décimales maximum.' }
  const thresholds = input.warning_thresholds
  if (!thresholds.length || new Set(thresholds).size !== thresholds.length || thresholds.some(n => !Number.isInteger(n) || n < 1 || n > 100)) fields.warning_thresholds = 'Seuils distincts entre 1 et 100, séparés par des virgules.'
  if (Object.keys(fields).length) throw new ValidationError(fields)
  return { ...input, budget_limit: limit, warning_thresholds: [...thresholds].sort((a, b) => a - b) }
}
export function sumExpenses(expenses: Expense[]): bigint { return expenses.reduce((sum, expense) => sum + (expense.deleted_at ? 0n : cents(expense.total)), 0n) }
export function budgetState(spent: bigint, budget: Budget | undefined) {
  if (!budget) return null
  const limit = cents(budget.budget_limit)
  return { remaining: limit - spent, percentage: (spent * 10000n / limit), crossed: budget.warning_thresholds.filter(threshold => spent * 100n >= limit * BigInt(threshold)) }
}
