import type { AccountDatabase, Operation, SyncedRow } from '../data/local/database'
import { total, type Entity } from '../domain/finance'
import type { Ledger } from '../services/ledger'
import { decodeRow, keyOf, payloadOf, putRow, tableOf } from './rows'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Sauvegarde invalide.')
  return value as Record<string, unknown>
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 50_000) throw new Error('Sauvegarde invalide ou trop volumineuse.')
  return value
}
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)
function localRow(entity: Entity, value: unknown, userId: string): SyncedRow {
  const raw = object(value)
  if (typeof raw.version !== 'string' || !/^(0|[1-9]\d*)$/.test(raw.version) || !Number.isSafeInteger(raw.local_revision) || Number(raw.local_revision) < 0) throw new Error('Version locale invalide.')
  return { ...decodeRow(entity, { ...raw, version: raw.version === '0' ? '1' : raw.version }, userId), version: raw.version, local_revision: Number(raw.local_revision) }
}
export function parseRecovery(json: string, db: AccountDatabase) {
  if (json.length > 10_000_000) throw new Error('La sauvegarde dépasse 10 Mo.')
  const root = object(JSON.parse(json) as unknown)
  if (root.format !== 'ny-volako-recovery' || (root.version !== 1 && root.version !== 2) || root.account !== db.userId || (root.version === 2 && root.source !== db.source)) throw new Error('Cette sauvegarde ne correspond pas au compte ou au serveur actuel.')
  const data = object(root.data)
  const rows = new Map<Entity, SyncedRow[]>([
    ['categories', array(data.categories).map(row => localRow('categories', row, db.userId))],
    ['expenses', array(data.expenses).map(row => localRow('expenses', row, db.userId))],
    ['monthly_budgets', array(data.budgets).map(row => localRow('monthly_budgets', row, db.userId))],
  ])
  for (const values of rows.values()) if (new Set(values.map(row => row.id)).size !== values.length) throw new Error('Identifiants dupliqués dans la sauvegarde.')
  const categories = new Set(rows.get('categories')!.map(row => row.id))
  if (rows.get('expenses')!.some(row => 'category_id' in row && !categories.has(row.category_id))) throw new Error('Une catégorie manque dans la sauvegarde.')
  const ops = array(root.operations).map(value => {
    const raw = object(value)
    if (!uuid(raw.operation_id) || !uuid(raw.entity_id) || raw.user_id !== db.userId || !['categories', 'expenses', 'monthly_budgets'].includes(String(raw.entity)) || !['create', 'update', 'delete'].includes(String(raw.kind)) || raw.format_version !== 1 || (raw.base_version !== null && (typeof raw.base_version !== 'string' || !/^(0|[1-9]\d*)$/.test(raw.base_version))) || (raw.predecessor_id !== null && !uuid(raw.predecessor_id)) || !Number.isSafeInteger(raw.sequence) || Number(raw.sequence) <= 0 || typeof raw.created_at !== 'string' || !Number.isFinite(Date.parse(raw.created_at))) throw new Error('Opération de sauvegarde invalide.')
    const entity = raw.entity as Entity
    const row = rows.get(entity)!.find(row => row.id === raw.entity_id)
    if (!row || (raw.kind === 'delete' && entity !== 'expenses')) throw new Error('Une opération ne correspond pas au carnet.')
    const payload = object(raw.payload)
    // Valider sans modifier le payload : un envoi antérieur a pu être confirmé par le serveur.
    if (raw.kind === 'delete') { if (Object.keys(payload).length) throw new Error('Suppression invalide.') }
    else {
      if (entity === 'expenses' && [payload.unit_price, payload.quantity, payload.extra_fee].some(value => typeof value !== 'string')) throw new Error('Décimales de sauvegarde invalides.')
      const decoded = localRow(entity, { ...row, ...payload, id: row.id, user_id: db.userId, version: row.version, local_revision: row.local_revision, ...(entity === 'expenses' ? { total: total(payload.unit_price as string, payload.quantity as string, payload.extra_fee as string) } : {}) }, db.userId)
      void decoded
      if (Object.keys(payload).sort().join(',') !== Object.keys(payloadOf(entity, row) as object).sort().join(',')) throw new Error('Payload de sauvegarde invalide.')
    }
    return { operation_id: raw.operation_id, entity_id: raw.entity_id, user_id: db.userId, entity, kind: raw.kind, payload: raw.payload, base_version: raw.base_version, predecessor_id: raw.predecessor_id, sequence: raw.sequence, created_at: raw.created_at, format_version: 1, base: raw.base ? localRow(entity, raw.base, db.userId) : null, status: 'pending', attempt_count: 0, next_retry_at: 0 } as Operation
  }).sort((a, b) => a.sequence! - b.sequence!)
  if (new Set(ops.map(op => op.operation_id)).size !== ops.length || new Set(ops.map(op => op.sequence)).size !== ops.length) throw new Error('Opérations dupliquées dans la sauvegarde.')
  const prior = new Map<string, Operation>()
  for (const op of ops) {
    const key = keyOf(op.entity, op.entity_id), previous = prior.get(key)
    if (previous && op.predecessor_id !== previous.operation_id) throw new Error('Chaîne d’opérations invalide.')
    prior.set(key, op)
  }
  return { rows, ops }
}

// Appel exclusivement dans une transaction d'import tenant le bail de synchronisation.
export async function restoreRecovery(ledger: Ledger, parsed: ReturnType<typeof parseRecovery>) {
  const db = ledger.db
  await ledger.writable()
  if (await db.queue.count()) throw new Error('Synchronisez ou résolvez les opérations actuelles avant de restaurer une sauvegarde.')
  const operations: Operation[] = []
  for (const op of parsed.ops) if (!await db.receipts.get(op.operation_id)) operations.push(op)
  for (const op of operations) {
    if (op.base_version === null && !operations.some(previous => previous.operation_id === op.predecessor_id) && !(op.predecessor_id && await db.receipts.get(op.predecessor_id))) throw new Error('La sauvegarde ne contient pas la confirmation nécessaire à une opération.')
  }
  const pending = new Set(operations.map(op => keyOf(op.entity, op.entity_id)))
  for (const [entity, rows] of parsed.rows) for (const row of rows) {
    if (!pending.has(keyOf(entity, row.id))) continue // Les données confirmées seront relues du serveur.
    const current = await tableOf(db, entity).get(row.id)
    if (current && current.version !== '0') await db.shadows.put({ key: keyOf(entity, current.id), entity, row: current })
    if (entity === 'monthly_budgets' && 'month_start' in row) {
      const existing = await db.budgets.where('month_start').equals(row.month_start).first()
      if (existing && existing.id !== row.id) { await db.shadows.put({ key: keyOf(entity, existing.id), entity, row: existing }); await db.budgets.delete(existing.id) }
    }
    await putRow(db, entity, { ...row, local_revision: Math.max(row.local_revision, current?.local_revision ?? 0) + 1 })
  }
  for (const op of operations) {
    const restored = { ...op }
    delete restored.sequence; delete restored.remote; delete restored.last_error
    await db.queue.add(restored)
  }
  await db.metadata.put({ key: 'edit_revision', value: crypto.randomUUID() })
  await ledger.alertsFor((await db.budgets.toArray()).map(row => row.month_start.slice(0, 7)))
}
