import { useState, type FormEvent } from 'react'
import { budgetState, dayInZone, fixed, money, sumExpenses, type Budget } from '../../domain/finance'
import { useFinance } from './context'
import { Field, PageHeading } from './shared'
import { fieldA11y, fieldsFrom } from './form-helpers'

export function Budgets() {
  const { data } = useFinance()
  const [month, setMonth] = useState(() => dayInZone(data.settings.timezone).slice(0, 7))
  const budget = data.budgets.find(row => row.month_start === `${month}-01`)
  const spent = sumExpenses(data.expenses.filter(row => row.expense_date.startsWith(`${month}-`)))
  const state = budgetState(spent, budget)
  return <><PageHeading title="Mon budget" description="Un budget indépendant pour chaque mois, avec vos propres seuils d’alerte." />
    <label className="month-selector">Mois du budget<input type="month" min="1900-01" max="9999-12" value={month} onChange={e => setMonth(e.target.value)} /></label>
    {month && <><div className="metric-grid"><div className="metric"><span>Dépensé</span><strong>{money(spent, data.settings.currency)}</strong></div><div className="metric"><span>Reste</span><strong>{state ? money(state.remaining, data.settings.currency) : 'Non défini'}</strong></div><div className="metric"><span>Budget consommé</span><strong>{state ? `${fixed(state.percentage).replace('.', ',')} %` : '—'}</strong></div></div>
      <BudgetForm key={month} month={month} budget={budget} /></>}
  </>
}
function BudgetForm({ month, budget }: { month: string; budget: Budget | undefined }) {
  const { ledger, data } = useFinance()
  const [baseline, setBaseline] = useState(budget)
  const [limit, setLimit] = useState(budget?.budget_limit ?? '')
  const [thresholds, setThresholds] = useState(budget?.warning_thresholds.join(', ') ?? '70, 85, 100')
  const [errors, setErrors] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return
    setBusy(true); setErrors({}); setSaved(false)
    try {
      const row = await ledger.saveBudget({ month_start: `${month}-01`, budget_limit: limit, warning_thresholds: thresholds.split(',').map(value => /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN) }, baseline?.local_revision ?? null)
      setBaseline(row)
      setSaved(true)
    } catch (error) { setErrors(fieldsFrom(error)) } finally { setBusy(false) }
  }
  return <form className="panel ledger-form" noValidate onSubmit={e => { void submit(e) }}><h2>{budget ? 'Modifier ce budget' : 'Définir ce budget'}</h2>
    {Object.keys(errors).length > 0 && <p role="alert">{errors.form ?? 'Vérifiez les champs signalés.'}</p>}
    <fieldset disabled={busy}><div className="form-grid"><Field name="budget_limit" label={`Budget mensuel (${data.settings.currency})`} error={errors.budget_limit}><input {...fieldA11y('budget_limit', errors)} inputMode="decimal" value={limit} required onChange={e => setLimit(e.target.value)} /></Field>
      <Field name="warning_thresholds" label="Seuils d’alerte (%)" error={errors.warning_thresholds}><input {...fieldA11y('warning_thresholds', errors)} value={thresholds} onChange={e => setThresholds(e.target.value)} /><span className="field-hint">Par exemple : 70, 85, 100. Les alertes sont affichées dans l’application.</span></Field></div>
      <button className="primary-link" type="submit">{busy ? 'Enregistrement…' : 'Enregistrer le budget'}</button></fieldset>
    {saved && <p role="status">Budget enregistré sur cet appareil.</p>}
    <p className="field-hint">Modifier ce mois ne change aucun autre budget. Les montants déjà dépensés sont pris en compte lors de la définition des seuils.</p>
  </form>
}
