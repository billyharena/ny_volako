import Dexie, { type Table } from 'dexie'
import type { Alert, Budget, Category, Entity, Expense, Settings } from '../../domain/finance'
import type { Json } from '../remote/database.types'

export type Operation = {
  sequence?: number; operation_id: string; user_id: string; entity: Entity; entity_id: string
  kind: 'create' | 'update' | 'delete'; payload: Json; base_version: string | null; predecessor_id: string | null
  created_at: string; attempt_count: number; status: 'pending' | 'sending' | 'retry' | 'blocked' | 'conflict'; format_version: 1
  next_retry_at?: number; last_error?: string; base?: SyncedRow | null; remote?: SyncedRow | null
}
export type SyncedRow = Category | Expense | Budget
export type Shadow = { key: string; entity: Entity; row: SyncedRow }
export type Receipt = { operation_id: string; entity: Entity; entity_id: string; row: SyncedRow }
type Metadata = { key: string; value: string }
type AlertState = { month: string; above: number[] }

export class AccountDatabase extends Dexie {
  categories!: Table<Category, string>
  expenses!: Table<Expense, string>
  budgets!: Table<Budget, string>
  settings!: Table<Settings, string>
  queue!: Table<Operation, number>
  metadata!: Table<Metadata, string>
  alertState!: Table<AlertState, string>
  alerts!: Table<Alert, string>
  shadows!: Table<Shadow, string>
  receipts!: Table<Receipt, string>
  resolutions!: Table<{ id: string; operations: Operation[]; choice: string; created_at: string }, string>
  constructor(readonly userId: string, readonly source: string) {
    super(`ny-volako-v1:${encodeURIComponent(source)}:${userId}`)
    this.version(1).stores({
      categories: 'id', expenses: 'id,expense_date,category_id', budgets: 'id,&month_start', settings: 'user_id',
      queue: '++sequence,&operation_id,[entity+entity_id],status', metadata: 'key', alertState: 'month', alerts: 'id,month,created_at',
    })
    this.version(2).stores({ shadows: 'key', receipts: 'operation_id', resolutions: 'id' })
  }
}
