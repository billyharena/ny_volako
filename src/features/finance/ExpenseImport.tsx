import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { categoryKey, expenseKey, parseExpenseCsv, type ImportRow } from '../../domain/expense-import'
import { cents, money } from '../../domain/finance'
import { useFinance } from './context'

export function ExpenseImport() {
  const { data, ledger, engine } = useFinance()
  const [rows, setRows] = useState<ImportRow[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [choices, setChoices] = useState<Record<number, boolean>>({})
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState(''), [message, setMessage] = useState('')
  const [page, setPage] = useState(0)
  const [filename, setFilename] = useState('')
  const active = data.categories.filter(category => category.is_active)
  const sources = [...new Set(rows.filter(row => row.input).map(row => row.category))]
  const preview = useMemo(() => {
    const seen = new Set(data.expenses.filter(row => !row.deleted_at).map(expenseKey))
    return rows.map(row => {
      const target = mapping[row.category] ?? ''
      const categoryId = target.startsWith('new:') ? data.categories.find(category => categoryKey(category.name) === categoryKey(row.category))?.id ?? target : target
      const input = row.input ? { ...row.input, category_id: categoryId } : undefined
      const key = input?.category_id ? expenseKey(input) : ''
      const duplicate = !!key && seen.has(key)
      if (key) seen.add(key)
      return { ...row, input, duplicate, selected: !!input && (choices[row.line] ?? !duplicate) }
    })
  }, [rows, mapping, choices, data.expenses, data.categories])
  const selected = preview.filter(row => row.selected)
  const amount = selected.reduce((sum, row) => sum + cents(row.total!), 0n)
  const errors = rows.filter(row => row.error).length
  const duplicates = preview.filter(row => row.duplicate).length

  async function readFile(file: File | undefined) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setMessage(''); setRows([]); setConfirmed(false); setChoices({}); setPage(0); setFilename(file?.name ?? '')
    try {
      if (!file) return
      if (file.size > 5_000_000) throw new Error('Le fichier dépasse 5 Mo.')
      const parsed = parseExpenseCsv(await file.text())
      const names = [...new Set(parsed.filter(row => row.input).map(row => row.category))]
      setMapping(Object.fromEntries(names.map(name => [name, active.find(category => categoryKey(category.name) === categoryKey(name))?.id ?? `new:${categoryKey(name)}`])))
      setRows(parsed)
    } catch (error) { setError(error instanceof Error ? error.message : 'Lecture impossible.') }
    finally { lock.current = false; setBusy(false) }
  }
  async function importSelected() {
    if (lock.current || !confirmed || !selected.length) return
    lock.current = true; setBusy(true); setError('')
    try {
      const newCategories = Object.fromEntries(sources.filter(name => mapping[name]?.startsWith('new:')).map(name => [mapping[name]!, name]))
      const result = await ledger.importExpenses(selected.map(row => ({ input: row.input!, allowDuplicate: row.duplicate && choices[row.line] === true })), newCategories)
      setMessage(`${result.imported} dépense(s) importée(s). ${result.skipped} doublon(s) supplémentaire(s) écarté(s). Les données sont enregistrées sur cet appareil ; leur synchronisation peut prendre quelques instants.`)
      setRows([]); setConfirmed(false); void engine.run(true)
    } catch (error) { setError(error instanceof Error ? error.message : 'Import impossible. Aucune ligne de cet import n’a été enregistrée.') }
    finally { lock.current = false; setBusy(false) }
  }

  return <div className="ledger-form" aria-busy={busy}>
    <div className="page-heading"><p className="eyebrow">VOTRE HISTORIQUE</p><h1>Importer des dépenses</h1><p>Depuis Google Sheets, ouvrez l’onglet Depenses puis choisissez Fichier → Télécharger → Valeurs séparées par des virgules (.csv).</p></div>
    <section className="panel">
      <h2>1. Choisir le fichier CSV</h2>
      <p>Colonnes requises : Motif, Date, Category, PU, Frais, Quantity. Les montants avec et sans frais, s’ils sont présents, sont vérifiés. Formats de date : AAAA-MM-JJ ou JJ/MM/AAAA. Maximum : 5 Mo et 5 000 dépenses.</p>
      <label>Fichier CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={event => { void readFile(event.target.files?.[0]); event.target.value = '' }} /></label>
      {filename && <p>Fichier sélectionné : {filename}</p>}
    </section>
    {rows.length > 0 && <>
      <section className="panel"><h2>2. Associer les catégories</h2><p>Conservez les noms du fichier ou choisissez une catégorie existante.</p>
        <div className="form-grid">{sources.map(name => <label key={name}>{name}<select disabled={busy} value={mapping[name]} onChange={event => { setMapping(current => ({ ...current, [name]: event.target.value })); setChoices({}); setConfirmed(false) }}>
          <option value={`new:${categoryKey(name)}`}>Conserver « {name} » (créer si nécessaire)</option>
          {active.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select></label>)}</div>
      </section>
      <section className="panel"><h2>3. Vérifier les dépenses</h2>
        <p role="status">{rows.length} ligne(s) · {errors} invalide(s) · {duplicates} doublon(s) possible(s) · {selected.length} sélectionnée(s), soit {money(amount, data.settings.currency)}.</p>
        <p>Les lignes invalides sont exclues. Corrigez-les dans le fichier puis rechargez-le. Les doublons sont comparés au carnet de cet appareil et au fichier (date, motif, catégorie, prix, quantité et frais identiques). Synchronisez le carnet avant l’import pour inclure les autres appareils.</p>
        <p>Un doublon possible est décoché par défaut. Cochez-le uniquement s’il correspond à un achat distinct à conserver.</p>
        <div className="import-table" role="region" aria-label="Aperçu du fichier" tabIndex={0}><table><thead><tr><th>Importer</th><th>Ligne</th><th>Date / motif</th><th>Catégorie du fichier</th><th>Total</th><th>Vérification</th></tr></thead>
          <tbody>{preview.slice(page * 50, (page + 1) * 50).map(row => <tr key={row.line}>
            <td><input type="checkbox" aria-label={`Importer la ligne ${row.line}`} disabled={busy || !!row.error} checked={row.selected} onChange={event => { setChoices(current => ({ ...current, [row.line]: event.target.checked })); setConfirmed(false) }} /></td>
            <td>{row.line}</td><td>{row.input?.expense_date}<br />{row.input?.motif ?? 'Ligne invalide'}</td><td>{row.category}</td><td>{row.total ? money(row.total, data.settings.currency) : '—'}</td><td>{row.error ?? (row.duplicate ? 'Doublon possible' : 'Prête')}</td>
          </tr>)}</tbody></table></div>
        <div className="form-actions"><button className="secondary-button" disabled={busy || page === 0} onClick={() => setPage(page - 1)}>Précédent</button><span>Page {page + 1} / {Math.ceil(rows.length / 50)}</span><button className="secondary-button" disabled={busy || (page + 1) * 50 >= rows.length} onClick={() => setPage(page + 1)}>Suivant</button></div>
        <label className="checkbox-label"><input type="checkbox" disabled={busy || !selected.length} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Je confirme l’ajout des {selected.length} dépenses sélectionnées et des catégories nécessaires.</label>
        <button className="primary-link" disabled={busy || !confirmed || !selected.length} onClick={() => { void importSelected() }}>{busy ? 'Import en cours…' : 'Confirmer l’import'}</button>
      </section>
    </>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status" className="success-message">{message}</p>}
    <Link to="/depenses">Voir mes dépenses</Link>
  </div>
}
