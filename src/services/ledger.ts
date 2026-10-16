import type { Json } from '../data/remote/database.types'
import { categoryKey, expenseKey, type ImportEntry } from '../domain/expense-import'
import { assertNotUpdating } from '../pwa/update-gate'
import { AccountDatabase, type Operation } from '../data/local/database'
import { budgetState, sumExpenses, validateExpense, validateBudget, ValidationError, type BudgetInput, type Category, type Entity, type ExpenseInput, type RecordBase, type Snapshot } from '../domain/finance'

export class Ledger {
  private active = true
  constructor(readonly db: AccountDatabase, private readonly sessionId: string) {}
  deactivate() { this.active = false }
  private guard() { if (!this.active) throw new Error('Ce compte n’est plus actif. Reconnectez-vous.') }
  async writable() {
    assertNotUpdating()
    this.guard()
    if (await this.db.metadata.get(`logout:${this.sessionId}`)) throw new Error('Cette session est verrouillée pour la déconnexion. Reconnectez-vous avant de modifier le carnet.')
  }
  private base(): RecordBase {
    const stamp = new Date().toISOString()
    return { id: crypto.randomUUID(), user_id: this.db.userId, created_at: stamp, updated_at: stamp, version: '0', local_revision: 1 }
  }
  private assertRevision(row: RecordBase | undefined, revision: number | undefined) {
    if (!row || row.user_id !== this.db.userId) throw new Error('Élément introuvable dans ce compte.')
    if (row.local_revision !== revision) throw new Error('Cet élément a changé dans un autre onglet. Rechargez la page avant de modifier.')
  }
  private async enqueue(entity: Entity, row: RecordBase, kind: Operation['kind'], payload: Json, base: Operation['base'] = null) {
    const previous = await this.db.queue.where('[entity+entity_id]').equals([entity, row.id]).sortBy('sequence')
    const predecessor = previous.at(-1)
    await this.db.queue.add({ operation_id: crypto.randomUUID(), user_id: this.db.userId, entity, entity_id: row.id, kind, payload,
      base_version: predecessor ? null : row.version, predecessor_id: predecessor?.operation_id ?? null,
      created_at: new Date().toISOString(), attempt_count: 0, status: 'pending', format_version: 1, base })
    await this.db.metadata.put({ key: 'edit_revision', value: crypto.randomUUID() })
  }
  async alertsFor(months: string[]) {
    for (const month of new Set(months)) {
      const budget = await this.db.budgets.where('month_start').equals(`${month}-01`).first()
      const rows = await this.db.expenses.where('expense_date').between(`${month}-01`, `${month}-31`, true, true).toArray()
      const crossed = budgetState(sumExpenses(rows), budget)?.crossed ?? []
      const previous = await this.db.alertState.get(month)
      const fresh = crossed.filter(threshold => !previous?.above.includes(threshold))
      await this.db.alertState.put({ month, above: crossed })
      if (fresh.length) await this.db.alerts.add({ id: crypto.randomUUID(), month, thresholds: fresh, created_at: new Date().toISOString(), dismissed: false })
    }
  }
  async saveExpense(input: ExpenseInput, id?: string, revision?: number) {
    const value = validateExpense(input)
    return this.db.transaction('rw', this.db.tables, async () => {
      await this.writable()
      const old = id ? await this.db.expenses.get(id) : undefined
      if (id) this.assertRevision(old, revision)
      if (old?.deleted_at) throw new Error('Cette dépense a été supprimée.')
      const category = await this.db.categories.get(value.category_id)
      if (!category || category.user_id !== this.db.userId || (!category.is_active && old?.category_id !== category.id)) throw new ValidationError({ category_id: 'Cette catégorie est indisponible.' })
      const row = { ...(old ?? this.base()), ...value, deleted_at: null, updated_at: new Date().toISOString(), local_revision: old ? old.local_revision + 1 : 1 }
      await this.db.expenses.put(row)
      const payload: ExpenseInput = { expense_date: value.expense_date, motif: value.motif, category_id: value.category_id, unit_price: value.unit_price, quantity: value.quantity, extra_fee: value.extra_fee }
      await this.enqueue('expenses', row, old ? 'update' : 'create', payload, old ?? null)
      await this.alertsFor([value.expense_date.slice(0, 7), ...(old ? [old.expense_date.slice(0, 7)] : [])])
      this.guard()
      return row.id
    })
  }
  async deleteExpense(id: string, revision: number) {
    return this.db.transaction('rw', this.db.tables, async () => {
      await this.writable()
      const old = await this.db.expenses.get(id)
      this.assertRevision(old, revision)
      if (!old || old.deleted_at) throw new Error('Cette dépense est déjà supprimée.')
      const stamp = new Date().toISOString()
      const row = { ...old, deleted_at: stamp, updated_at: stamp, local_revision: old.local_revision + 1 }
      await this.db.expenses.put(row)
      await this.enqueue('expenses', row, 'delete', {}, old)
      await this.alertsFor([row.expense_date.slice(0, 7)])
      this.guard()
    })
  }
  async importExpenses(entries: ImportEntry[], newCategories: Record<string, string>) {
    if (!entries.length || entries.length > 5000) throw new Error('Sélectionnez de 1 à 5 000 dépenses.')
    const validated = entries.map(entry => ({ ...entry, input: validateExpense(entry.input) }))
    return this.db.transaction('rw', this.db.tables, async () => {
      await this.writable()
      const categories = await this.db.categories.toArray()
      const resolved = new Map<string, string>()
      const seen = new Set((await this.db.expenses.toArray()).filter(row => !row.deleted_at).map(expenseKey))
      const months = new Set<string>()
      let imported = 0, skipped = 0
      for (const entry of validated) {
        const sourceId = entry.input.category_id
        let categoryId = resolved.get(sourceId) ?? sourceId
        if (!resolved.has(sourceId) && Object.hasOwn(newCategories, sourceId)) {
          const name = newCategories[sourceId]!
          const matching = categories.find(category => categoryKey(category.name) === categoryKey(name))
          if (matching && !matching.is_active) throw new Error(`La catégorie « ${name} » est archivée. Réactivez-la ou choisissez une autre catégorie.`)
          const category = matching ?? await this.saveCategory(name, true)
          if (!matching) categories.push(category)
          categoryId = category.id; resolved.set(sourceId, categoryId)
        }
        const category = categories.find(category => category.id === categoryId && category.user_id === this.db.userId && category.is_active)
        if (!category) throw new Error('Une catégorie est devenue indisponible. Revérifiez les associations.')
        const value = { ...entry.input, category_id: categoryId }
        const key = expenseKey(value)
        if (seen.has(key) && !entry.allowDuplicate) { skipped++; continue }
        const row = { ...this.base(), ...value, deleted_at: null }
        await this.db.expenses.add(row)
        const payload: ExpenseInput = { expense_date: value.expense_date, motif: value.motif, category_id: categoryId, unit_price: value.unit_price, quantity: value.quantity, extra_fee: value.extra_fee }
        await this.enqueue('expenses', row, 'create', payload)
        seen.add(key); months.add(value.expense_date.slice(0, 7)); imported++
      }
      await this.alertsFor([...months])
      this.guard()
      return { imported, skipped }
    })
  }
  async saveCategory(name: string, isActive: boolean, old?: Category) {
    name = name.trim()
    if (!name || [...name].length > 80) throw new ValidationError({ name: 'Nom de 1 à 80 caractères requis.' })
    return this.db.transaction('rw', this.db.tables, async () => {
      await this.writable()
      if (old) this.assertRevision(await this.db.categories.get(old.id), old.local_revision)
      const row: Category = { ...(old ?? this.base()), name, is_active: isActive, icon: old?.icon ?? null, updated_at: new Date().toISOString(), local_revision: old ? old.local_revision + 1 : 1 }
      await this.db.categories.put(row)
      await this.enqueue('categories', row, old ? 'update' : 'create', { name, icon: row.icon, is_active: isActive }, old ?? null)
      this.guard()
      return row
    })
  }
  async saveBudget(input: BudgetInput, expectedRevision: number | null) {
    const value = validateBudget(input)
    return this.db.transaction('rw', this.db.tables, async () => {
      await this.writable()
      const old = await this.db.budgets.where('month_start').equals(value.month_start).first()
      if (old) this.assertRevision(old, expectedRevision ?? undefined)
      else if (expectedRevision !== null) throw new Error('Budget introuvable. Rechargez la page.')
      const row = { ...(old ?? this.base()), ...value, updated_at: new Date().toISOString(), local_revision: old ? old.local_revision + 1 : 1 }
      await this.db.budgets.put(row)
      await this.enqueue('monthly_budgets', row, old ? 'update' : 'create', value, old ?? null)
      await this.alertsFor([value.month_start.slice(0, 7)])
      this.guard()
      return row
    })
  }
  async snapshot(): Promise<Snapshot> {
    return this.db.transaction('r', this.db.tables, async () => {
      this.guard()
      const settings = await this.db.settings.get(this.db.userId)
      if (!settings) throw new Error('Le compte local n’est pas initialisé.')
      const operations = await this.db.queue.toArray()
      return { settings, categories: await this.db.categories.toArray(), expenses: await this.db.expenses.toArray(), budgets: await this.db.budgets.toArray(), pending: operations.length, pendingIds: operations.map(op => op.entity_id), alerts: (await this.db.alerts.toArray()).filter(alert => !alert.dismissed) }
    })
  }
  async dismissAlert(id: string) { this.guard(); await this.db.alerts.update(id, { dismissed: true }) }
  async exportRecovery() {
    return this.db.transaction('r', this.db.tables, async () => {
      this.guard()
      return JSON.stringify({ format: 'ny-volako-recovery', version: 2, source: this.db.source, account: this.db.userId, revision: (await this.db.metadata.get('edit_revision'))?.value ?? '', created_at: new Date().toISOString(), data: await this.snapshot(), operations: await this.db.queue.toArray() }, null, 2)
    })
  }
  async prepareSignOut(exportedCount: number, confirmed: boolean, exportedRevision?: string) {
    await this.db.transaction('rw', this.db.tables, async () => {
      this.guard()
      const pending = await this.db.queue.count()
      if (pending && (!confirmed || exportedCount !== pending || (exportedRevision !== undefined && exportedRevision !== ((await this.db.metadata.get('edit_revision'))?.value ?? '')))) throw new Error('Des opérations restent en attente. Téléchargez une sauvegarde à jour et confirmez sa réception avant de vous déconnecter.')
      // Les autres onglets de cette session ne peuvent plus écrire après ce contrôle.
      await this.db.metadata.put({ key: `logout:${this.sessionId}`, value: new Date().toISOString() })
    })
  }
  async cancelSignOut() { this.guard(); await this.db.metadata.delete(`logout:${this.sessionId}`) }
}
