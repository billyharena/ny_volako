import { useState } from 'react'
import { useFinance } from './context'

export function BudgetAlerts() {
  const { data, ledger } = useFinance()
  const [error, setError] = useState('')
  return <>{error && <p role="alert">{error}</p>}{[...data.alerts].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(alert => <div className="budget-alert" role="status" key={alert.id}>
    <div><strong>Seuil{alert.thresholds.length > 1 ? 's' : ''} franchi{alert.thresholds.length > 1 ? 's' : ''} : {alert.thresholds.map(n => `${n} %`).join(', ')}</strong><p>Budget de {alert.month.split('-').reverse().join('/')} · franchissement enregistré sur cet appareil.</p></div>
    <button className="secondary-button" type="button" onClick={() => { void ledger.dismissAlert(alert.id).catch(() => setError('Impossible de masquer cette alerte. Réessayez.')) }}>Masquer l’alerte</button>
  </div>)}</>
}
