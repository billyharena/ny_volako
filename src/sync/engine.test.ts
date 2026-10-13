import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountDatabase, type Operation, type SyncedRow } from '../data/local/database'
import type { Category, Expense } from '../domain/finance'
import { Ledger } from '../services/ledger'
import { SyncEngine } from './engine'
import { SyncFailure, retryDelay, type Transport } from './transport'
import { keyOf } from './rows'

const user = '11111111-1111-4111-8111-111111111111'
const categoryId = '22222222-2222-4222-8222-222222222222'
const stamp = '2026-10-12T12:00:00Z'
const category: Category = { id: categoryId, user_id: user, name: 'Courses', icon: null, is_active: true, created_at: stamp, updated_at: stamp, version: '1', local_revision: 0 }
const expense = { expense_date: '2026-10-12', motif: 'Achat', category_id: categoryId, unit_price: '25', quantity: '1', extra_fee: '0' }

class Server implements Transport {
  rows = new Map<string, SyncedRow>([[keyOf('categories', categoryId), category]])
  receipts = new Map<string, unknown>()
  requests: Operation[] = []
  loseReply = false
  failure: SyncFailure | null = null
  authorize = vi.fn(async () => {})
  async apply(op: Operation): Promise<unknown> {
    this.requests.push(structuredClone(op))
    if (this.failure) throw this.failure
    if (this.receipts.has(op.operation_id)) return this.receipts.get(op.operation_id)
    const key = keyOf(op.entity, op.entity_id), remote = this.rows.get(key)
    if (op.base_version !== (remote?.version ?? '0') || (remote && 'deleted_at' in remote && remote.deleted_at)) return { status: 'conflict', remote: remote ?? null }
    const payload = op.payload as Record<string, unknown>
    const row = { ...(remote ?? { id: op.entity_id, user_id: user, created_at: stamp, local_revision: 0 }), ...payload, updated_at: stamp, version: String(BigInt(op.base_version!) + 1n), ...(op.entity === 'expenses' ? { total: (Number(payload.unit_price ?? (remote as Expense)?.unit_price) * Number(payload.quantity ?? (remote as Expense)?.quantity) + Number(payload.extra_fee ?? (remote as Expense)?.extra_fee)).toFixed(2), deleted_at: op.kind === 'delete' ? stamp : null } : {}) } as SyncedRow
    this.rows.set(key, row)
    const receipt = { status: 'applied', operation_id: op.operation_id, row }
    this.receipts.set(op.operation_id, receipt)
    if (this.loseReply) { this.loseReply = false; throw new SyncFailure('retry', 'Réponse perdue') }
    return receipt
  }
  async page(entity: string, after?: string) {
    if (entity === 'user_settings') return []
    return [...this.rows.entries()].filter(([key, row]) => key.startsWith(`${entity}:`) && (!after || row.id > after)).map(([, row]) => row).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 500)
  }
}
let db: AccountDatabase, ledger: Ledger, server: Server, engine: SyncEngine
beforeEach(async () => {
  db = new AccountDatabase(user, crypto.randomUUID()); ledger = new Ledger(db, 'session'); server = new Server(); engine = new SyncEngine(ledger, server)
  await db.categories.put(category)
  await db.settings.put({ user_id: user, currency: 'MGA', timezone: 'Indian/Antananarivo', locale: 'fr', theme: 'system', version: '1' })
})
afterEach(async () => { await engine.stop(); await db.delete(); vi.restoreAllMocks() })
async function retryNow() { await db.queue.toCollection().modify({ next_retry_at: 0 }) }

describe('synchronisation durable', () => {
  it('envoie les dépendances et acquitte création, édition et suppression sans doublon', async () => {
    const cat = await ledger.saveCategory('Transport', true)
    const id = await ledger.saveExpense({ ...expense, category_id: cat.id })
    await ledger.saveExpense({ ...expense, category_id: cat.id, quantity: '2' }, id, 1)
    await ledger.deleteExpense(id, 2)
    await engine.run()
    expect(await db.queue.count()).toBe(0)
    expect(server.requests.map(op => op.entity)).toEqual(['categories', 'expenses', 'expenses', 'expenses'])
    expect(server.requests.map(op => op.base_version)).toEqual(['0', '0', '1', '2'])
    expect((await db.expenses.get(id))?.deleted_at).toBe(stamp)
    expect(await db.receipts.count()).toBe(4)
  })
  it('reprend le même UUID et payload après commit serveur sans réponse, puis après réouverture', async () => {
    const id = await ledger.saveExpense(expense)
    server.loseReply = true
    await engine.run()
    expect((await db.queue.toArray())[0]?.status).toBe('retry')
    expect(server.receipts.size).toBe(1)
    await engine.stop(); db.close(); await db.open()
    engine = new SyncEngine(ledger, server)
    await retryNow(); await engine.run()
    expect(await db.queue.count()).toBe(0)
    expect(server.requests[1]?.operation_id).toBe(server.requests[0]?.operation_id)
    expect(server.requests[1]?.payload).toEqual(server.requests[0]?.payload)
    expect((await db.expenses.get(id))?.version).toBe('1')
  })
  it('conserve une saisie plus récente pendant un envoi puis utilise la version acquittée', async () => {
    const id = await ledger.saveExpense(expense)
    const apply = server.apply.bind(server)
    let edited = false
    server.apply = async op => {
      if (!edited) { edited = true; await ledger.saveExpense({ ...expense, motif: 'Version récente' }, id, 1) }
      return apply(op)
    }
    await engine.run()
    expect((await db.expenses.get(id))?.motif).toBe('Version récente')
    expect(server.requests.map(op => op.base_version)).toEqual(['0', '1'])
  })
  it('préserve les intentions en conflit et applique le choix local avec un nouvel UUID', async () => {
    const id = await ledger.saveExpense(expense); await engine.run()
    const before = (await db.expenses.get(id))!
    server.rows.set(keyOf('expenses', id), { ...before, motif: 'Autre appareil', version: '2' })
    await ledger.saveExpense({ ...expense, motif: 'Mon choix' }, id, before.local_revision)
    await engine.run()
    const op = (await db.queue.toArray())[0]!
    expect(op.status).toBe('conflict')
    expect((await db.expenses.get(id))?.motif).toBe('Mon choix')
    await engine.resolve(op.operation_id, 'local', (await db.expenses.get(id))!.local_revision)
    expect((await db.queue.toArray())[0]?.operation_id).not.toBe(op.operation_id)
    await engine.run()
    expect((await db.expenses.get(id))?.version).toBe('3')
    expect(await db.queue.count()).toBe(0)
    expect(await db.resolutions.count()).toBe(1)
  })
  it('ne ressuscite pas une suppression distante et accepte le choix serveur', async () => {
    const id = await ledger.saveExpense(expense); await engine.run()
    const before = (await db.expenses.get(id))!
    server.rows.set(keyOf('expenses', id), { ...before, deleted_at: stamp, version: '2' })
    await ledger.saveExpense({ ...expense, motif: 'Edition hors ligne' }, id, before.local_revision); await engine.run()
    const op = (await db.queue.toArray())[0]!
    await expect(engine.resolve(op.operation_id, 'local', before.local_revision + 1)).rejects.toThrow('supprimée')
    await engine.resolve(op.operation_id, 'remote', before.local_revision + 1)
    expect((await db.expenses.get(id))?.deleted_at).toBe(stamp)
    expect(await db.queue.count()).toBe(0)
  })
  it('bloque une erreur permanente mais continue les entités indépendantes', async () => {
    await ledger.saveExpense(expense); await ledger.saveCategory('Indépendante', true)
    const apply = server.apply.bind(server)
    server.apply = async op => { if (op.entity === 'expenses') throw new SyncFailure('blocked', 'Refus'); return apply(op) }
    await engine.run()
    expect(await db.queue.count()).toBe(1)
    expect((await db.queue.toArray())[0]?.status).toBe('blocked')
    expect(server.requests).toHaveLength(1)
  })
  it('suspend les envois à expiration Auth et reprend seulement après action explicite', async () => {
    await ledger.saveExpense(expense)
    server.authorize.mockRejectedValueOnce(new SyncFailure('auth', 'Expiration'))
    await engine.run(); await engine.run()
    expect(server.authorize).toHaveBeenCalledTimes(1)
    expect(server.requests).toHaveLength(0)
    await engine.run(true)
    expect(await db.queue.count()).toBe(0)
  })
  it('ignore une réponse tardive après arrêt du compte', async () => {
    const id = await ledger.saveExpense(expense)
    let complete!: (result: unknown) => void
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const apply = server.apply.bind(server)
    server.apply = async op => { const result = await apply(op); entered(); return new Promise(resolve => { complete = () => resolve(result) }) }
    const running = engine.run(); await started
    const stopped = engine.stop(); complete(null); await running; await stopped
    expect(await db.queue.count()).toBe(1)
    expect((await db.expenses.get(id))?.version).toBe('0')
  })
  it('exclut un autre onglet et reprend un bail abandonné avec une opération sending', async () => {
    await ledger.saveExpense(expense)
    await db.queue.toCollection().modify({ status: 'sending' })
    await db.metadata.put({ key: 'sync_lease', value: JSON.stringify({ owner: 'other', until: Date.now() + 60_000 }) })
    await engine.run(); expect(server.requests).toHaveLength(0)
    await db.metadata.put({ key: 'sync_lease', value: JSON.stringify({ owner: 'other', until: 0 }) })
    await engine.run(); expect(await db.queue.count()).toBe(0)
  })
  it('reprend après échec du commit local d’acquittement sans doubler la mutation serveur', async () => {
    await ledger.saveExpense(expense)
    vi.spyOn(db.receipts, 'put').mockRejectedValueOnce(new Error('Quota'))
    await engine.run()
    expect(await db.queue.count()).toBe(1)
    expect(server.receipts.size).toBe(1)
    await retryNow(); await engine.run()
    expect(await db.queue.count()).toBe(0)
    expect(server.receipts.size).toBe(1)
  })
  it('fusionne les pages par version et recalcule les alertes sans répétition', async () => {
    await ledger.saveBudget({ month_start: '2026-10-01', budget_limit: '100', warning_thresholds: [70, 100] }, null)
    await engine.run()
    const id = crypto.randomUUID()
    server.rows.set(keyOf('expenses', id), { ...expense, id, user_id: user, created_at: stamp, updated_at: stamp, unit_price: '75.00', quantity: '1.000', extra_fee: '0.00', total: '75.00', deleted_at: null, version: '1', local_revision: 0 })
    await engine.run(); await engine.run()
    expect((await db.alerts.toArray()).map(row => row.thresholds)).toEqual([[70]])
    server.rows.delete(keyOf('expenses', id)); await engine.run()
    expect(await db.expenses.get(id)).toBeDefined() // Absence != suppression.
  })
  it('respecte le backoff borné et Retry-After', () => {
    expect(retryDelay(1, 0, 0.5)).toBe(2000)
    expect(retryDelay(20, 600_000, 0)).toBe(600_000)
  })
  it('ne réessaie pas avant Retry-After et reprend après une panne avant commit', async () => {
    await ledger.saveExpense(expense)
    server.failure = new SyncFailure('retry', 'Indisponible', 60_000)
    await engine.run(); await engine.run(true)
    expect(server.requests).toHaveLength(1)
    expect(server.receipts.size).toBe(0)
    expect((await db.queue.toArray())[0]!.next_retry_at).toBeGreaterThan(Date.now() + 50_000)
    server.failure = null; await retryNow(); await engine.run()
    expect(await db.queue.count()).toBe(0)
  })
  it('réconcilie deux budgets du même mois sans doublon ni perte de l’intention', async () => {
    const local = await ledger.saveBudget({ month_start: '2026-10-01', budget_limit: '100', warning_thresholds: [70] }, null)
    const remote = { ...local, id: crypto.randomUUID(), budget_limit: '200.00', version: '1' }
    server.rows.set(keyOf('monthly_budgets', remote.id), remote)
    const apply = server.apply.bind(server)
    server.apply = async op => op.entity_id === local.id ? { status: 'conflict', reason: 'month_already_exists', remote } : apply(op)
    await engine.run()
    expect(await db.budgets.count()).toBe(1)
    const op = (await db.queue.toArray())[0]!
    await engine.resolve(op.operation_id, 'local', local.local_revision); await engine.run()
    expect(await db.budgets.count()).toBe(1)
    expect((await db.budgets.toArray())[0]).toMatchObject({ id: remote.id, budget_limit: '100.00', version: '2' })
  })
  it('lit au-delà de 500 lignes puis recommence au début au cycle suivant', async () => {
    for (let index = 0; index < 501; index++) {
      const row = { ...category, id: crypto.randomUUID(), name: `Catégorie ${index}` }
      server.rows.set(keyOf('categories', row.id), row)
    }
    const pages = vi.spyOn(server, 'page')
    await engine.run()
    expect(await db.categories.count()).toBe(502)
    expect(pages.mock.calls.filter(call => call[0] === 'categories')).toHaveLength(2)
    await engine.run()
    expect(pages.mock.calls.filter(call => call[0] === 'categories')[2]?.[1]).toBeUndefined()
  })
  it('refuse un reçu appartenant à un autre compte sans effacer la file', async () => {
    const id = await ledger.saveExpense(expense)
    const apply = server.apply.bind(server)
    server.apply = async op => {
      const receipt = await apply(op) as { status: string; operation_id: string; row: SyncedRow }
      return { ...receipt, row: { ...receipt.row, user_id: crypto.randomUUID() } }
    }
    await engine.run()
    expect(await db.queue.count()).toBe(1)
    expect((await db.expenses.get(id))?.user_id).toBe(user)
    expect((await db.expenses.get(id))?.version).toBe('0')
  })
  it('refuse un choix si une nouvelle saisie est apparue après son affichage', async () => {
    const id = await ledger.saveExpense(expense); await engine.run()
    const before = (await db.expenses.get(id))!
    server.rows.set(keyOf('expenses', id), { ...before, version: '2' })
    await ledger.saveExpense({ ...expense, motif: 'Intention 1' }, id, before.local_revision); await engine.run()
    const shown = (await db.expenses.get(id))!, op = (await db.queue.toArray())[0]!
    await ledger.saveExpense({ ...expense, motif: 'Intention 2' }, id, shown.local_revision)
    await expect(engine.resolve(op.operation_id, 'remote', shown.local_revision)).rejects.toThrow('changé')
    expect(await db.queue.count()).toBe(2)
  })
  it('invalide une sauvegarde de déconnexion même si le nombre d’opérations est identique', async () => {
    await ledger.saveExpense(expense)
    const backup = JSON.parse(await ledger.exportRecovery()) as { revision: string }
    await engine.run(); await ledger.saveExpense(expense)
    await expect(ledger.prepareSignOut(1, true, backup.revision)).rejects.toThrow('sauvegarde')
  })
  it('honore une relance demandée pendant la lecture finale du cycle', async () => {
    const original = server.page.bind(server)
    let queued = false
    server.page = async (entity, after) => {
      if (entity === 'user_settings' && !queued) {
        queued = true
        await ledger.saveExpense(expense)
        void engine.run(true)
      }
      return original(entity, after)
    }
    await engine.run()
    await expect.poll(() => db.queue.count()).toBe(0)
    expect(server.requests).toHaveLength(1)
  })
  it('restaure une sauvegarde avec la chaîne exacte et refuse un autre compte', async () => {
    const id = await ledger.saveExpense(expense)
    await ledger.saveExpense({ ...expense, quantity: '2' }, id, 1)
    const backup = await ledger.exportRecovery(), original = await db.queue.toArray()
    await expect(engine.restore(backup)).rejects.toThrow('actuelles')
    await db.queue.clear(); await db.expenses.clear()
    await engine.restore(backup)
    expect((await db.queue.toArray()).map(op => op.operation_id)).toEqual(original.map(op => op.operation_id))
    await engine.run(); expect(await db.queue.count()).toBe(0)
    expect((await db.expenses.get(id))?.total).toBe('50.00')
    await engine.restore(backup); expect(await db.queue.count()).toBe(0)
    await expect(engine.restore(backup.replace(user, crypto.randomUUID()))).rejects.toThrow('compte')
  })
  it('migre un carnet Dexie v1 sans effacer sa file', async () => {
    const upgraded = new AccountDatabase(user, `${db.source}-migration`)
    const old = new Dexie(upgraded.name)
    old.version(1).stores({ categories: 'id', expenses: 'id,expense_date,category_id', budgets: 'id,&month_start', settings: 'user_id', queue: '++sequence,&operation_id,[entity+entity_id],status', metadata: 'key', alertState: 'month', alerts: 'id,month,created_at' })
    await old.table('queue').add({ operation_id: 'kept', entity: 'categories', entity_id: categoryId, status: 'pending' }); old.close()
    await upgraded.open(); expect(await upgraded.queue.count()).toBe(1)
    expect(upgraded.verno).toBe(2); expect(await upgraded.receipts.count()).toBe(0)
    await upgraded.delete()
  })
})
