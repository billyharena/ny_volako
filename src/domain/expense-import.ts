import { decimal, fixed, total, validateExpense, type ExpenseInput } from './finance'

export type ImportRow = { line: number; category: string; input?: ExpenseInput; total?: string; error?: string }
export type ImportEntry = { input: ExpenseInput; allowDuplicate: boolean }
export const categoryKey = (name: string) => name.trim().normalize('NFC').toLocaleLowerCase('fr')
export function expenseKey(input: ExpenseInput) {
  const row = validateExpense(input)
  return JSON.stringify([row.expense_date, row.motif.normalize('NFC'), row.category_id, row.unit_price, row.quantity, row.extra_fee])
}

// RFC-style quoted fields, escaped quotes and embedded newlines; no formula evaluation.
function readCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false, closed = false
  const cell = () => { row.push(field); field = ''; closed = false }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { quoted = false; closed = true }
      } else field += ch
    } else if (ch === delimiter) cell()
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      cell(); rows.push(row); row = []
    } else if (ch === '"' && field === '' && !closed) quoted = true
    else {
      if (closed || ch === '"') throw new Error('CSV mal formé : vérifiez les guillemets.')
      field += ch
    }
    if (rows.length > 5001) throw new Error('Maximum 5 000 dépenses par fichier.')
  }
  if (quoted) throw new Error('CSV mal formé : guillemet non fermé.')
  if (field || row.length || closed) { cell(); rows.push(row) }
  return rows
}

export function parseExpenseCsv(source: string): ImportRow[] {
  if (source.length > 5_000_000) throw new Error('Le fichier dépasse 5 Mo.')
  const text = source.replace(/^\uFEFF/, '')
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = firstLine.includes(';') ? ';' : ','
  const rows = readCsv(text, delimiter)
  const headers = (rows.shift() ?? []).map(value => categoryKey(value))
  const required = ['motif', 'date', 'category', 'pu', 'frais', 'quantity']
  for (const name of required) if (headers.filter(header => header === name).length !== 1) throw new Error(`Colonne requise unique : ${name}. Utilisez l’export CSV de l’onglet Depenses.`)
  if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) throw new Error('Le fichier contient des en-têtes en double.')
  const numeric = (value: string) => value.trim().replace(/[ \u00a0\u202f]/g, '').replace(',', '.')
  const result = rows.flatMap((cells, index): ImportRow[] => {
    if (cells.every(cell => !cell.trim())) return []
    const get = (name: string) => (cells[headers.indexOf(name)] ?? '').trim()
    const row: ImportRow = { line: index + 2, category: get('category') }
    try {
      if (cells.length !== headers.length) throw new Error('Nombre de colonnes incorrect.')
      if (!row.category || [...row.category].length > 80) throw new Error('Catégorie de 1 à 80 caractères requise.')
      let date = get('date')
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) date = `${date.slice(6)}-${date.slice(3, 5)}-${date.slice(0, 2)}`
      const value = validateExpense({ motif: get('motif'), expense_date: date, category_id: row.category,
        unit_price: numeric(get('pu')), extra_fee: numeric(get('frais')), quantity: numeric(get('quantity')) })
      for (const [header, expected] of [['montant sans frais', total(value.unit_price, value.quantity, '0')], ['montant avec frais', value.total]]) {
        if (get(header!) && fixed(decimal(numeric(get(header!)), 2, 22)) !== expected) throw new Error(`Écart dans « ${header} » : montant recalculé ${expected}.`)
      }
      row.input = value; row.total = value.total
    } catch (error) { row.error = error instanceof Error ? error.message : 'Ligne invalide.' }
    return [row]
  })
  if (!result.length) throw new Error('Le fichier ne contient aucune dépense.')
  if (result.length > 5000) throw new Error('Maximum 5 000 dépenses par fichier.')
  return result
}
