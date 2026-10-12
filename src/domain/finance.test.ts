import { describe, expect, it } from 'vitest'
import { budgetState, cents, dayInZone, decimal, fixed, money, total, validDate, validateBudget, validateExpense, type Budget } from './finance'

describe('calculs exacts et validation', () => {
  it.each([
    ['1250', '1', '0', '1250.00'], ['1250', '3', '200', '3950.00'],
    ['1.01', '0.5', '0', '0.51'], ['0.01', '0.499', '0', '0.00'],
    ['0,10', '3', '0,20', '0.50'], ['0', '2', '12.25', '12.25'],
    ['999999999999.99', '9999999.999', '999999999999.99', '10000000998999899999.99'],
  ])('%s × %s + %s = %s', (price, quantity, fee, expected) => { expect(total(price, quantity, fee)).toBe(expected) })
  it.each(['NaN', 'Infinity', '-1', '1e3', '', '1.001', '1000000000000', '1,2,3', '01', '0x10'])('rejette un prix invalide : %s', price => { expect(() => total(price, '1', '0')).toThrow() })
  it.each(['0', '-1', '0.0001', '10000000'])('rejette une quantité invalide : %s', quantity => { expect(() => total('1', quantity, '0')).toThrow() })
  it('formate les sommes et les restes négatifs sans conversion flottante', () => {
    expect(fixed(-123n)).toBe('-1.23')
    expect(cents('-1.23')).toBe(-123n)
    expect(money(-123n)).toBe('−1,23 Ar')
    expect(money('99999999999999999999.99')).toContain(',99 Ar')
    expect(decimal('12,3', 2, 12)).toBe(1230n)
  })
  it('valide les dates civiles et le fuseau budgétaire', () => {
    expect(validDate('2024-02-29')).toBe(true)
    expect(validDate('2025-02-29')).toBe(false)
    expect(validDate('1899-12-31')).toBe(false)
    expect(validDate('2026-13-01')).toBe(false)
    expect(dayInZone('Indian/Antananarivo', new Date('2026-10-31T22:00:00Z'))).toBe('2026-11-01')
  })
  it('normalise les saisies et recalcule le total', () => {
    expect(validateExpense({ expense_date: '2026-10-11', motif: ' Café ', category_id: 'category', unit_price: '10,5', quantity: '2', extra_fee: '0' })).toMatchObject({ motif: 'Café', unit_price: '10.50', quantity: '2.000', total: '21.00' })
  })
  it('interdit les seuils répétés, vides, décimaux et hors limites', () => {
    for (const thresholds of [[], [70, 70], [0], [101], [50.5], [NaN]]) expect(() => validateBudget({ month_start: '2026-10-01', budget_limit: '100', warning_thresholds: thresholds })).toThrow()
    expect(() => validateBudget({ month_start: '2026-10-02', budget_limit: '100', warning_thresholds: [70] })).toThrow()
    expect(() => validateBudget({ month_start: '2026-10-01', budget_limit: '0', warning_thresholds: [70] })).toThrow()
  })
  it('traite absence de budget, seuil exact et dépassement', () => {
    const budget = { budget_limit: '100.00', warning_thresholds: [70, 85, 100] } as Budget
    expect(budgetState(500n, undefined)).toBeNull()
    expect(budgetState(7000n, budget)).toEqual({ remaining: 3000n, percentage: 7000n, crossed: [70] })
    expect(budgetState(11000n, budget)).toEqual({ remaining: -1000n, percentage: 11000n, crossed: [70, 85, 100] })
  })
})
