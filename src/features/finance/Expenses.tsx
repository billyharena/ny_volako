import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { money, sumExpenses, today, total, type Expense, type ExpenseInput } from '../../domain/finance'
import { useFinance } from './context'
import { Field, PageHeading } from './shared'
import { fieldA11y, fieldsFrom } from './form-helpers'

export function ExpenseHistory() {
  const { data } = useFinance()
  const [search, setSearch] = useState(''), [category, setCategory] = useState('')
  const [from, setFrom] = useState(''), [to, setTo] = useState('')
  const location = useLocation()
  const invalidPeriod = Boolean(from && to && from > to)
  const expenses = data.expenses.filter(expense => !expense.deleted_at && !invalidPeriod
    && expense.motif.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr'))
    && (!category || expense.category_id === category) && (!from || expense.expense_date >= from) && (!to || expense.expense_date <= to))
    .sort((a, b) => b.expense_date.localeCompare(a.expense_date) || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
  const names = new Map(data.categories.map(category => [category.id, category.name]))
  return <>
    <PageHeading title="Mes dépenses" description="Retrouvez vos achats, leur détail et leur total sur cet appareil." />
    {location.state?.saved && <p role="status" className="success-message">Enregistré sur cet appareil · en attente de synchronisation.</p>}
    {location.state?.deleted && <p role="status" className="success-message">Dépense supprimée sur cet appareil · en attente de synchronisation.</p>}
    <section className="panel filters" aria-label="Filtres des dépenses">
      <label>Rechercher un motif<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <label>Catégorie<select value={category} onChange={event => setCategory(event.target.value)}><option value="">Toutes les catégories</option>{data.categories.map(item => <option key={item.id} value={item.id}>{item.name}{item.is_active ? '' : ' (désactivée)'}</option>)}</select></label>
      <label>Du<input type="date" min="1900-01-01" max="9999-12-31" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>Au<input type="date" min="1900-01-01" max="9999-12-31" value={to} onChange={event => setTo(event.target.value)} /></label>
      <button type="button" className="secondary-button" onClick={() => { setSearch(''); setCategory(''); setFrom(''); setTo('') }}>Effacer les filtres</button>
    </section>
    {invalidPeriod && <p role="alert">La date de début doit précéder la date de fin.</p>}
    <div className="section-heading"><h2>{expenses.length} dépense{expenses.length > 1 ? 's' : ''}</h2><strong>Total filtré : {money(sumExpenses(expenses), data.settings.currency)}</strong></div>
    {!expenses.length ? <div className="panel empty-state"><h2>Aucune dépense à afficher</h2><p>Ajoutez votre premier achat ou ajustez les filtres.</p><Link className="primary-link" to="/depenses/nouvelle">Ajouter une dépense</Link></div>
      : <ul className="expense-list">{expenses.map(expense => <li key={expense.id}>
        <div><Link className="expense-title" to={`/depenses/${expense.id}`}>{expense.motif}</Link><p>{expense.expense_date.split('-').reverse().join('/')} · {names.get(expense.category_id) ?? 'Catégorie indisponible'}</p><span className="sync-chip">{data.pendingIds?.includes(expense.id) ? 'En attente' : 'Confirmée serveur'}</span></div>
        <strong>{money(expense.total, data.settings.currency)}</strong>
      </li>)}</ul>}
  </>
}

export function ExpenseEditor() {
  const { id } = useParams()
  const { data } = useFinance()
  const expense = id ? data.expenses.find(row => row.id === id) : undefined
  if (id && (!expense || expense.deleted_at)) return <div className="panel"><h1>Dépense indisponible</h1><p>Elle n’existe pas dans ce compte ou a été supprimée.</p><Link to="/depenses">Retour à l’historique</Link></div>
  return <ExpenseForm key={id ?? 'new'} expense={expense} />
}

function ExpenseForm({ expense }: { expense: Expense | undefined }) {
  const { data, ledger } = useFinance()
  const navigate = useNavigate()
  const [original] = useState(expense)
  const [input, setInput] = useState<ExpenseInput>(() => expense ?? { expense_date: today(), motif: '', category_id: '', unit_price: '', quantity: '1', extra_fee: '0' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false), [confirmDelete, setConfirmDelete] = useState(false)
  let computed = '—'
  try { computed = money(total(input.unit_price, input.quantity, input.extra_fee), data.settings.currency) } catch { /* Aperçu incomplet, validation à la soumission. */ }
  const categories = data.categories.filter(category => category.is_active || category.id === original?.category_id)
  function update(field: keyof ExpenseInput, value: string) { setInput(previous => ({ ...previous, [field]: value })) }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return
    setBusy(true); setErrors({})
    try { await ledger.saveExpense(input, original?.id, original?.local_revision); navigate('/depenses', { replace: true, state: { saved: true } }) }
    catch (error) { setErrors(fieldsFrom(error)) } finally { setBusy(false) }
  }
  async function remove() {
    if (!original || busy) return
    setBusy(true); setErrors({})
    try { await ledger.deleteExpense(original.id, original.local_revision); navigate('/depenses', { replace: true, state: { deleted: true } }) }
    catch (error) { setErrors(fieldsFrom(error)); setConfirmDelete(false) } finally { setBusy(false) }
  }
  return <>
    <PageHeading title={original ? 'Détail de la dépense' : 'Ajouter une dépense'} description="Un achat, quelques repères. Le total se calcule automatiquement." />
    <form className="panel ledger-form" onSubmit={event => { void submit(event) }} noValidate>
      {Object.keys(errors).length > 0 && <p role="alert" className="field-error">{errors.form ?? 'Vérifiez les champs signalés ci-dessous.'}</p>}
      <fieldset disabled={busy}><div className="form-grid">
        <Field name="expense_date" label="Date" error={errors.expense_date}><input {...fieldA11y('expense_date', errors)} type="date" min="1900-01-01" max="9999-12-31" required value={input.expense_date} onChange={e => update('expense_date', e.target.value)} /></Field>
        <Field name="category_id" label="Catégorie" error={errors.category_id}><select {...fieldA11y('category_id', errors)} required value={input.category_id} onChange={e => update('category_id', e.target.value)}><option value="">Choisir une catégorie</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}{category.is_active ? '' : ' (désactivée)'}</option>)}</select></Field>
        <div className="full-width"><Field name="motif" label="Motif" error={errors.motif}><input {...fieldA11y('motif', errors)} required maxLength={240} value={input.motif} placeholder="Courses, déjeuner, trajet…" onChange={e => update('motif', e.target.value)} /></Field></div>
        <Field name="unit_price" label="Prix unitaire" error={errors.unit_price}><input {...fieldA11y('unit_price', errors)} inputMode="decimal" required value={input.unit_price} onChange={e => update('unit_price', e.target.value)} /></Field>
        <Field name="quantity" label="Quantité" error={errors.quantity}><input {...fieldA11y('quantity', errors)} inputMode="decimal" required value={input.quantity} onChange={e => update('quantity', e.target.value)} /></Field>
        <Field name="extra_fee" label="Frais supplémentaires" error={errors.extra_fee}><input {...fieldA11y('extra_fee', errors)} inputMode="decimal" required value={input.extra_fee} onChange={e => update('extra_fee', e.target.value)} /></Field>
        <div className="total-preview"><span>Total calculé</span><output aria-live="polite">{computed}</output></div>
      </div><div className="form-actions"><button className="primary-link" type="submit">{busy ? 'Enregistrement…' : 'Enregistrer la dépense'}</button><Link to="/depenses" className="secondary-button">Annuler</Link></div></fieldset>
      <p className="field-hint">Prix unitaire × quantité + frais. Les montants sont exprimés en {data.settings.currency}.</p>
    </form>
    {original && <section className="panel"><h2>Suppression</h2>{confirmDelete ? <><p>Confirmer la suppression de « {original.motif} » ? Elle sera retirée des totaux et conservée comme suppression en attente.</p><button type="button" className="danger-button" disabled={busy} onClick={() => { void remove() }}>Confirmer la suppression</button><button className="secondary-button" disabled={busy} onClick={() => setConfirmDelete(false)}>Conserver la dépense</button></> : <button className="danger-button" type="button" onClick={() => setConfirmDelete(true)}>Supprimer cette dépense</button>}</section>}
  </>
}
