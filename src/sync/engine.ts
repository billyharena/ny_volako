import { liveQuery } from 'dexie'
import type { Operation, SyncedRow } from '../data/local/database'
import { decodeSettings } from '../data/remote/bootstrap'
import type { Entity } from '../domain/finance'
import type { Ledger } from '../services/ledger'
import { decodeRow, keyOf, payloadOf, putRow, tableOf } from './rows'
import { retryDelay, SyncFailure, type Transport } from './transport'
import { parseRecovery, restoreRecovery } from './recovery'

export type SyncState = { phase: 'idle' | 'syncing' | 'offline' | 'auth' | 'retry' | 'error'; message: string }
const LEASE_MS = 60_000
type Lease = { owner: string; until: number }

export class SyncEngine {
  private readonly owner = crypto.randomUUID()
  private controller = new AbortController()
  private active = true
  private running: Promise<void> | null = null
  private nextRun = 0
  private authPaused = false
  private paused = false
  private rerun = false
  private hasPending = false
  private cleanup: (() => void) | undefined
  constructor(readonly ledger: Ledger, private readonly transport: Transport, private readonly report: (state: SyncState) => void = () => {}) {}
  private get db() { return this.ledger.db }
  private guard() { if (!this.active) throw new Error('Synchronisation arrêtée.'); this.controller.signal.throwIfAborted() }
  private async fence() {
    this.guard()
    await this.ledger.writable()
    const value = await this.db.metadata.get('sync_lease')
    const lease = value ? JSON.parse(value.value) as Lease : null
    if (lease?.owner !== this.owner || lease.until <= Date.now()) throw new Error('Bail de synchronisation expiré.')
    await this.db.metadata.put({ key: 'sync_lease', value: JSON.stringify({ owner: this.owner, until: Date.now() + LEASE_MS }) })
  }
  private async claim() {
    return this.db.transaction('rw', this.db.metadata, async () => {
      this.guard(); await this.ledger.writable()
      const value = await this.db.metadata.get('sync_lease')
      const lease = value ? JSON.parse(value.value) as Lease : null
      if (lease && lease.owner !== this.owner && lease.until > Date.now()) return false
      await this.db.metadata.put({ key: 'sync_lease', value: JSON.stringify({ owner: this.owner, until: Date.now() + LEASE_MS }) })
      return true
    })
  }
  private async release() {
    await this.db.transaction('rw', this.db.metadata, async () => {
      const value = await this.db.metadata.get('sync_lease')
      if (value && (JSON.parse(value.value) as Lease).owner === this.owner) await this.db.metadata.delete('sync_lease')
    })
  }
  start() {
    let previous = ''
    const subscription = liveQuery(() => this.db.queue.orderBy('sequence').toArray()).subscribe({
      next: rows => {
        this.hasPending = rows.some(row => row.status !== 'blocked' && row.status !== 'conflict')
        const signature = rows.map(row => row.operation_id).join(',')
        if (signature !== previous) { previous = signature; this.nextRun = 0; void this.run() }
      }, error: () => this.report({ phase: 'error', message: 'La file locale ne peut pas être lue. Les données sont conservées.' }),
    })
    const wake = () => { this.nextRun = 0; void this.run() }
    const timer = window.setInterval(() => { if (!this.running && (this.hasPending || document.visibilityState === 'visible') && Date.now() >= this.nextRun) void this.run() }, 2000)
    window.addEventListener('online', wake); window.addEventListener('offline', wake); document.addEventListener('visibilitychange', wake)
    this.cleanup = () => { subscription.unsubscribe(); clearInterval(timer); window.removeEventListener('online', wake); window.removeEventListener('offline', wake); document.removeEventListener('visibilitychange', wake) }
    void this.run()
  }
  async stop() {
    this.active = false; this.controller.abort(); this.cleanup?.()
    await this.running
  }
  async pause() { this.paused = true; this.controller.abort(); await this.running; this.controller = new AbortController() }
  resume() { this.paused = false; this.nextRun = 0; void this.run(true) }
  async run(manual = false): Promise<void> {
    if (!this.active || this.paused) return
    if (this.running) { this.rerun = true; return this.running }
    if (manual) this.authPaused = false
    if (this.authPaused) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) { this.report({ phase: 'offline', message: 'Hors ligne. Vos saisies restent enregistrées sur cet appareil.' }); return }
    const execute = async () => {
      if (!await this.claim()) { this.report({ phase: 'idle', message: 'Un autre onglet détient le relais. La reprise automatique peut prendre jusqu’à une minute après sa fermeture.' }); return }
      try { await this.cycle() } finally { await this.release() }
    }
    this.running = (async () => {
      try {
        if (typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request(`ny-volako-sync:${this.db.name}`, { ifAvailable: true }, async lock => { if (lock) await execute() })
        else await execute()
      } catch (error) {
        if (!this.active || this.paused) return
        const failure = error instanceof SyncFailure ? error : new SyncFailure('blocked', 'Synchronisation interrompue. Les données sont conservées ; réessayez ou exportez une sauvegarde.')
        this.authPaused = failure.kind === 'auth'
        this.nextRun = Date.now() + retryDelay(4, failure.retryAfter)
        this.report({ phase: failure.kind === 'blocked' ? 'error' : failure.kind, message: failure.label })
      }
    })().finally(() => {
      this.running = null
      if (this.rerun && this.active && !this.paused) { this.rerun = false; this.nextRun = 0; void this.run() }
    })
    return this.running
  }
  private async cycle() {
    this.report({ phase: 'syncing', message: 'Synchronisation en cours…' })
    await this.transport.authorize(this.controller.signal)
    await this.db.transaction('rw', this.db.metadata, () => this.fence())
    // Un lot borné évite qu'une saisie continue empêche les lectures distantes.
    for (let count = 0; count < 200; count++) {
      const op = await this.prepare()
      if (!op) break
      try {
        const result = await this.transport.apply(op, this.controller.signal)
        await this.accept(op, result)
      } catch (error) {
        this.guard()
        const failure = error instanceof SyncFailure ? error : new SyncFailure('retry', 'Réponse non confirmée. La même opération sera réessayée.')
        await this.db.transaction('rw', this.db.tables, async () => {
          await this.fence()
          const current = await this.db.queue.get(op.sequence!)
          if (current?.operation_id !== op.operation_id) return
          await this.db.queue.update(op.sequence!, { status: failure.kind === 'blocked' ? 'blocked' : 'retry', last_error: failure.label, next_retry_at: Date.now() + retryDelay(op.attempt_count, failure.retryAfter) })
          this.guard()
        })
        if (failure.kind === 'auth') throw failure
      }
    }
    for (const entity of ['categories', 'expenses', 'monthly_budgets', 'user_settings'] as const) {
      let after: string | undefined
      for (;;) {
        await this.db.transaction('rw', this.db.metadata, () => this.fence())
        const raw = await this.transport.page(entity, after, this.controller.signal)
        if (!Array.isArray(raw) || raw.length > 500) throw new SyncFailure('retry', 'Lecture distante incomplète. Une nouvelle tentative est prévue.')
        await this.db.transaction('rw', this.db.tables, async () => {
          await this.fence()
          for (const item of raw) {
            if (entity === 'user_settings') {
              const settings = decodeSettings(item, this.db.userId)
              if (after && settings.user_id <= after) throw new Error('Pagination invalide.')
              after = settings.user_id
              const local = await this.db.settings.get(this.db.userId)
              if (!local || BigInt(settings.version) > BigInt(local.version)) await this.db.settings.put(settings)
            } else {
              const row = decodeRow(entity, item, this.db.userId)
              if (after && row.id <= after) throw new Error('Pagination invalide.')
              after = row.id
              await this.merge(entity, row)
            }
          }
          await this.recalculateAlerts(); this.guard()
        })
        if (raw.length < 500) break
      }
    }
    await this.db.transaction('rw', this.db.metadata, async () => { await this.fence(); await this.db.metadata.put({ key: 'last_sync', value: new Date().toISOString() }) })
    const pending = await this.db.queue.toArray()
    this.nextRun = Math.min(Date.now() + 30_000, ...pending.filter(op => op.status === 'retry').map(op => op.next_retry_at ?? 0))
    this.report({ phase: 'idle', message: pending.length ? 'Certaines opérations restent à traiter. Consultez leur état.' : 'Toutes les opérations sont confirmées par le serveur.' })
  }
  private async prepare(): Promise<Operation | undefined> {
    return this.db.transaction('rw', this.db.tables, async () => {
      await this.fence()
      const operations = await this.db.queue.orderBy('sequence').toArray()
      for (const op of operations) {
        if (op.status === 'conflict' || op.status === 'blocked' || (op.next_retry_at ?? 0) > Date.now()) continue
        if (operations.some(prior => prior.entity === op.entity && prior.entity_id === op.entity_id && prior.sequence! < op.sequence!)) continue
        if (op.entity === 'expenses' && op.kind !== 'delete' && op.payload && typeof op.payload === 'object' && !Array.isArray(op.payload)) {
          const categoryId = op.payload.category_id
          if (operations.some(prior => prior.entity === 'categories' && prior.entity_id === categoryId)) continue
        }
        if (op.base_version === null) {
          const receipt = op.predecessor_id ? await this.db.receipts.get(op.predecessor_id) : null
          if (!receipt) { await this.db.queue.update(op.sequence!, { status: 'blocked', last_error: 'Une confirmation précédente manque. Restaurez une sauvegarde complète.' }); continue }
          op.base_version = receipt.row.version
        }
        op.status = 'sending'; op.attempt_count++
        await this.db.queue.put(op); this.guard()
        return op
      }
    })
  }
  private async accept(op: Operation, raw: unknown) {
    if (!raw || typeof raw !== 'object' || !('status' in raw)) throw new Error('Reçu invalide.')
    if (raw.status === 'conflict' && 'remote' in raw) {
      const remote = raw.remote === null ? null : decodeRow(op.entity, raw.remote, this.db.userId)
      if (remote && remote.id !== op.entity_id && !(op.entity === 'monthly_budgets' && 'month_start' in remote && op.payload && typeof op.payload === 'object' && !Array.isArray(op.payload) && remote.month_start === op.payload.month_start)) throw new Error('Conflit incohérent.')
      await this.db.transaction('rw', this.db.tables, async () => {
        await this.fence()
        if ((await this.db.queue.get(op.sequence!))?.operation_id !== op.operation_id) return
        await this.db.queue.update(op.sequence!, { status: 'conflict', remote, last_error: 'Une autre version existe sur le serveur. Choisissez la version à conserver.' })
        if (remote) await this.db.shadows.put({ key: keyOf(op.entity, remote.id), entity: op.entity, row: remote })
        this.guard()
      }); return
    }
    if (raw.status !== 'applied' || !('operation_id' in raw) || raw.operation_id !== op.operation_id || !('row' in raw)) throw new Error('Reçu invalide.')
    const row = decodeRow(op.entity, raw.row, this.db.userId)
    if (row.id !== op.entity_id || BigInt(row.version) !== BigInt(op.base_version!) + 1n) throw new Error('Version de reçu invalide.')
    await this.db.transaction('rw', this.db.tables, async () => {
      await this.fence()
      if ((await this.db.queue.get(op.sequence!))?.operation_id !== op.operation_id) return
      await this.db.receipts.put({ operation_id: op.operation_id, entity: op.entity, entity_id: op.entity_id, row })
      await this.db.queue.delete(op.sequence!)
      const successors = await this.db.queue.where('[entity+entity_id]').equals([op.entity, op.entity_id]).toArray()
      for (const next of successors) if (next.predecessor_id === op.operation_id && next.base_version === null) await this.db.queue.update(next.sequence!, { base_version: row.version, base: row })
      const local = await tableOf(this.db, op.entity).get(row.id)
      if (successors.length && local) await putRow(this.db, op.entity, { ...local, version: row.version })
      else if (!local || BigInt(row.version) >= BigInt(local.version)) await putRow(this.db, op.entity, { ...row, local_revision: (local?.local_revision ?? 0) + 1 })
      await this.db.shadows.put({ key: keyOf(op.entity, row.id), entity: op.entity, row })
      await this.recalculateAlerts(); this.guard()
    })
  }
  private async merge(entity: Entity, remote: SyncedRow) {
    const local = await tableOf(this.db, entity).get(remote.id)
    const operations = await this.db.queue.where('[entity+entity_id]').equals([entity, remote.id]).toArray()
    const oldShadow = await this.db.shadows.get(keyOf(entity, remote.id))
    if (!oldShadow || BigInt(remote.version) >= BigInt(oldShadow.row.version)) await this.db.shadows.put({ key: keyOf(entity, remote.id), entity, row: remote })
    if (operations.length) {
      for (const op of operations) if (op.status === 'blocked') await this.db.queue.update(op.sequence!, { remote })
      return // Seule la RPC peut trancher : un reçu perdu pourrait déjà exister.
    }
    if (entity === 'monthly_budgets' && 'month_start' in remote) {
      const sameMonth = await this.db.budgets.where('month_start').equals(remote.month_start).first()
      if (sameMonth && sameMonth.id !== remote.id) {
        if (await this.db.queue.where('[entity+entity_id]').equals([entity, sameMonth.id]).count()) return
        await this.db.budgets.delete(sameMonth.id)
      }
    }
    if (!local || BigInt(remote.version) > BigInt(local.version)) await putRow(this.db, entity, { ...remote, local_revision: (local?.local_revision ?? 0) + 1 })
  }
  private async recalculateAlerts() { await this.ledger.alertsFor((await this.db.budgets.toArray()).map(budget => budget.month_start.slice(0, 7))) }

  async restore(json: string) {
    const parsed = parseRecovery(json, this.db)
    if (this.running) throw new Error('Une synchronisation est en cours. Réessayez dans quelques instants.')
    this.running = (async () => {
      if (!await this.claim()) throw new Error('Un autre onglet synchronise le carnet. Réessayez dans quelques instants.')
      try {
        await this.db.transaction('rw', this.db.tables, async () => { await this.fence(); await restoreRecovery(this.ledger, parsed); this.guard() })
      } finally { await this.release() }
    })().finally(() => { this.running = null; this.nextRun = 0 })
    return this.running
  }

  async resolve(operationId: string, choice: 'local' | 'remote', expectedRevision: number) {
    await this.db.transaction('rw', this.db.tables, async () => {
      this.guard(); await this.ledger.writable()
      const op = await this.db.queue.where('operation_id').equals(operationId).first()
      if (!op || !['conflict', 'blocked'].includes(op.status)) throw new Error('Cet élément a changé. Actualisez la page.')
      const chain = await this.db.queue.where('[entity+entity_id]').equals([op.entity, op.entity_id]).sortBy('sequence')
      if (chain[0]?.operation_id !== op.operation_id) throw new Error('Résolvez d’abord l’opération précédente.')
      const local = await tableOf(this.db, op.entity).get(op.entity_id)
      if (!local || local.local_revision !== expectedRevision) throw new Error('Le carnet a changé. Vérifiez la nouvelle intention locale avant de confirmer.')
      const remote = op.remote ?? null
      if (choice === 'local' && remote && 'deleted_at' in remote && remote.deleted_at) throw new Error('Cette dépense a été supprimée à distance. Elle ne peut pas être réactivée.')
      if (choice === 'remote' && !remote && op.entity === 'categories' && await this.db.expenses.where('category_id').equals(op.entity_id).filter(row => !row.deleted_at).count()) throw new Error('Réaffectez les dépenses de cette catégorie avant de l’abandonner.')
      await this.db.resolutions.add({ id: crypto.randomUUID(), operations: chain, choice, created_at: new Date().toISOString() })
      await this.db.queue.bulkDelete(chain.map(item => item.sequence!))
      if (remote && remote.id !== local.id) await tableOf(this.db, op.entity).delete(local.id)
      if (choice === 'remote') {
        if (remote) await putRow(this.db, op.entity, { ...remote, local_revision: local.local_revision + 1 })
        else await tableOf(this.db, op.entity).delete(local.id)
      } else {
        const row = { ...local, id: remote?.id ?? local.id, version: remote?.version ?? '0', local_revision: local.local_revision + 1 }
        const deleted = 'deleted_at' in row && Boolean(row.deleted_at)
        if (deleted && !remote) await tableOf(this.db, op.entity).delete(local.id)
        else {
          await putRow(this.db, op.entity, row)
          await this.db.queue.add({ operation_id: crypto.randomUUID(), user_id: this.db.userId, entity: op.entity, entity_id: row.id, kind: deleted ? 'delete' : remote ? 'update' : 'create', payload: deleted ? {} : payloadOf(op.entity, row), base_version: row.version, predecessor_id: null, base: remote, created_at: new Date().toISOString(), status: 'pending', attempt_count: 0, format_version: 1 })
        }
      }
      await this.db.metadata.put({ key: 'edit_revision', value: crypto.randomUUID() })
      await this.recalculateAlerts(); this.guard()
    })
    this.nextRun = 0
  }
}
