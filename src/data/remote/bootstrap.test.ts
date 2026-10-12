import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { AccountDatabase } from '../local/database'
import { decodeCategory, decodeExpense, initializeLocalAccount } from './bootstrap'
import type { AppClient } from './client'

const owner = '11111111-1111-4111-8111-111111111111'
const base = { id: 'aaaaaaaa-1111-4111-8111-111111111111', user_id: owner, version: '1', created_at: '2026-10-11T00:00:00Z', updated_at: '2026-10-11T00:00:00Z' }
describe('frontière réseau du carnet', () => {
  it('rejette un propriétaire différent et une version JSON numérique', () => {
    expect(() => decodeCategory({ ...base, user_id: 'other', name: 'Autres', icon: null, is_active: true }, owner)).toThrow('compte')
    expect(() => decodeCategory({ ...base, version: 1, name: 'Autres', icon: null, is_active: true }, owner)).toThrow()
  })
  it('vérifie le total reçu et refuse un montant en flottant', () => {
    const row = { ...base, category_id: base.id, expense_date: '2026-10-11', motif: 'Test', unit_price: '1.01', quantity: '0.500', extra_fee: '0.00', total: '0.51', deleted_at: null }
    expect(decodeExpense(row, owner).total).toBe('0.51')
    expect(() => decodeExpense({ ...row, total: '0.50' }, owner)).toThrow()
    expect(() => decodeExpense({ ...row, unit_price: 1.01 }, owner)).toThrow()
  })
  it('ne remplace pas un carnet déjà initialisé lors de la réouverture', async () => {
    const db = new AccountDatabase(owner, crypto.randomUUID())
    const rpc = vi.fn()
    try {
      await db.metadata.put({ key: 'initialized', value: 'ready' })
      await db.categories.put(decodeCategory({ ...base, name: 'Personnel', icon: null, is_active: true }, owner))
      await initializeLocalAccount(db, { rpc } as unknown as AppClient, new AbortController().signal)
      expect(rpc).not.toHaveBeenCalled()
      expect((await db.categories.toArray())[0]?.name).toBe('Personnel')
    } finally { await db.delete() }
  })
})
