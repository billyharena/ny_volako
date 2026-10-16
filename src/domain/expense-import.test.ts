import { describe, expect, it } from 'vitest'
import { expenseKey, parseExpenseCsv } from './expense-import'

const header = 'Motif,Date,Category,PU,Frais,Quantity,Montant sans frais,Montant avec frais\n'
describe('import CSV', () => {
  it('lit un export Sheets français avec BOM, espaces insécables et frais seuls', () => {
    const rows = parseExpenseCsv('\uFEFF' + header + 'Bus,2026-04-28,Mobility,"600,00","0,00",4,"2\u202f400,00","2\u202f400,00"\r\nRetrait,2026-04-28,Money,0,550,1,0,550\r\n')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.input).toMatchObject({ unit_price: '600.00', quantity: '4.000', total: '2400.00' })
    expect(rows[1]?.total).toBe('550.00')
  })
  it('accepte point-virgule, date française, guillemets et saut de ligne dans un motif', () => {
    const rows = parseExpenseCsv('Motif;Date;Category;PU;Frais;Quantity\n"Pain; ""frais""\nmatin";28/04/2026;Food;1000,50;0;1,5')
    expect(rows[0]?.input).toMatchObject({ motif: 'Pain; "frais"\nmatin', expense_date: '2026-04-28', quantity: '1.500', total: '1500.75' })
  })
  it('signale écarts de total, dates impossibles, négatifs et quantités nulles par ligne', () => {
    const rows = parseExpenseCsv(header + 'A,2026-04-28,Food,10,0,1,10,11\nB,2026-02-30,Food,10,0,1,10,10\nC,2026-04-28,Food,-1,0,1,,\nD,2026-04-28,Food,1,0,0,,')
    expect(rows.every(row => row.error && !row.input)).toBe(true)
    expect(rows[0]?.error).toContain('Écart')
    expect(rows.map(row => row.line)).toEqual([2, 3, 4, 5])
  })
  it('rejette les fichiers mal formés et les colonnes manquantes ou dupliquées', () => {
    expect(() => parseExpenseCsv(header + '"non fermé')).toThrow('guillemet')
    expect(() => parseExpenseCsv('Motif,Date\nA,2026-04-28')).toThrow('Colonne')
    expect(() => parseExpenseCsv(header.trim() + ',Motif\n')).toThrow('unique')
    expect(parseExpenseCsv(header + 'A,2026-04-28,Food,1,0,1')[0]?.error).toContain('colonnes')
  })
  it('ignore les lignes vides et refuse un fichier vide ou trop volumineux', () => {
    expect(parseExpenseCsv(header + '\n,,,,,,,\nA,2026-04-28,Food,1,0,1,,')).toHaveLength(1)
    expect(() => parseExpenseCsv(header)).toThrow('aucune')
    expect(() => parseExpenseCsv('x'.repeat(5_000_001))).toThrow('5 Mo')
    expect(() => parseExpenseCsv(header + 'A,2026-04-28,Food,1,0,1,,\n'.repeat(5001))).toThrow('5 000')
  })
  it('normalise les nombres pour comparer les doublons sans fusionner des montants différents', () => {
    const a = parseExpenseCsv(header + 'A,2026-04-28,Food,1,0,1,,')[0]!.input!
    expect(expenseKey(a)).toBe(expenseKey({ ...a, unit_price: '1,00', quantity: '1' }))
    expect(expenseKey(a)).not.toBe(expenseKey({ ...a, extra_fee: '1' }))
  })
})
