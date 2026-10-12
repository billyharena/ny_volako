import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { budgetState, cents, dayInZone, fixed, money, sumExpenses } from '../../domain/finance'
import { useFinance } from './context'
import { PageHeading } from './shared'
import { ChartBoundary } from './ChartBoundary'

const Charts = lazy(() => import('./Charts'))

export function Dashboard() {
  const { data } = useFinance()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    const refresh = () => setNow(new Date())
    document.addEventListener('visibilitychange', refresh)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  const day = dayInZone(data.settings.timezone, now), month = day.slice(0, 7)
  const expenses = data.expenses.filter(row => !row.deleted_at)
  const current = expenses.filter(row => row.expense_date.startsWith(`${month}-`))
  const spent = sumExpenses(current)
  const budget = data.budgets.find(row => row.month_start === `${month}-01`)
  const state = budgetState(spent, budget)
  const names = new Map(data.categories.map(row => [row.id, row.name]))
  const byDay = new Map<string, bigint>(), byCategory = new Map<string, bigint>()
  for (const row of current) {
    byDay.set(row.expense_date, (byDay.get(row.expense_date) ?? 0n) + cents(row.total))
    byCategory.set(row.category_id, (byCategory.get(row.category_id) ?? 0n) + cents(row.total))
  }
  const monthDays = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate()
  const daily = Array.from({ length: monthDays }, (_, index) => {
    const name = String(index + 1).padStart(2, '0'), value = byDay.get(`${month}-${name}`) ?? 0n
    return { name, amount: Number(value) / 100, exact: money(value, data.settings.currency) }
  })
  const categories = [...byCategory].sort((a, b) => a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : a[0].localeCompare(b[0])).map(([id, value]) => ({ id, name: names.get(id) ?? 'Catégorie indisponible', amount: Number(value) / 100, exact: money(value, data.settings.currency) }))
  const recent = [...expenses].sort((a, b) => b.expense_date.localeCompare(a.expense_date) || b.created_at.localeCompare(a.created_at)).slice(0, 5)
  return <>
    <PageHeading title="Vue d’ensemble" description={`Votre mois de ${new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: data.settings.timezone }).format(now)} · ${data.settings.timezone}`} />
    <div className="metric-grid"><div className="metric"><span>Aujourd’hui</span><strong>{money(sumExpenses(expenses.filter(row => row.expense_date === day)), data.settings.currency)}</strong></div>
      <div className="metric metric-dark"><span>Ce mois-ci</span><strong>{money(spent, data.settings.currency)}</strong></div>
      <div className="metric"><span>Budget mensuel</span><strong>{budget ? money(budget.budget_limit, data.settings.currency) : 'Non défini'}</strong><Link to="/budgets">{budget ? 'Ajuster le budget' : 'Définir mon budget'} →</Link></div>
      <div className="metric"><span>{state && state.remaining < 0n ? 'Dépassement du budget' : 'Montant restant'}</span><strong>{state ? money(state.remaining, data.settings.currency) : '—'}</strong></div></div>
    {state && <section className="panel budget-progress"><div className="section-heading"><h2>Consommation du budget</h2><strong>{fixed(state.percentage).replace('.', ',')} %</strong></div><progress max={100} value={Number(state.percentage > 10000n ? 10000n : state.percentage) / 100} aria-label="Consommation du budget" /><p>{state.remaining < 0n ? 'Le budget de ce mois est dépassé.' : 'Vos dépenses locales sont incluses dans ce montant.'}</p></section>}
    {!current.length ? <section className="panel empty-state"><h2>Votre mois commence ici</h2><p>Aucune dépense enregistrée pour ce mois.</p><Link className="primary-link" to="/depenses/nouvelle">Ajouter ma première dépense</Link></section>
      : <><ChartBoundary><Suspense fallback={<p>Préparation des graphiques…</p>}><Charts daily={daily} categories={categories} /></Suspense></ChartBoundary>
        <details className="panel"><summary>Consulter les chiffres des graphiques</summary><div className="chart-grid"><div><h3>Par jour</h3><ul>{daily.map(row => <li key={row.name}>{row.name}/{month.slice(5)} : {row.exact}</li>)}</ul></div><div><h3>Par catégorie</h3><ul>{categories.map(row => <li key={row.id}>{row.name} : {row.exact}</li>)}</ul></div></div></details></>}
    <section className="panel"><div className="section-heading"><h2>Dernières dépenses</h2><Link to="/depenses">Tout l’historique →</Link></div>{!recent.length ? <p>Votre carnet est encore vide.</p> : <ul className="expense-list">{recent.map(row => <li key={row.id}><div><Link className="expense-title" to={`/depenses/${row.id}`}>{row.motif}</Link><p>{row.expense_date.split('-').reverse().join('/')} · {names.get(row.category_id)}</p></div><strong>{money(row.total, data.settings.currency)}</strong></li>)}</ul>}</section>
  </>
}
