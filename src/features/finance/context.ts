import { createContext, useContext } from 'react'
import type { Snapshot } from '../../domain/finance'
import type { Ledger } from '../../services/ledger'
import type { SyncEngine, SyncState } from '../../sync/engine'

export const FinanceContext = createContext<{ ledger: Ledger; data: Snapshot; engine: SyncEngine; sync: SyncState } | null>(null)
export function useFinance() {
  const value = useContext(FinanceContext)
  if (!value) throw new Error('Le compte local n’est pas disponible.')
  return value
}
