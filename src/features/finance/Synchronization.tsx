import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { liveQuery } from 'dexie'
import type { Operation, SyncedRow } from '../../data/local/database'
import { useFinance } from './context'
import { PageHeading } from './shared'
import { money } from '../../domain/finance'

function RowSummary({ row }: { row: SyncedRow | null | undefined }) {
  const { data } = useFinance()
  if (!row) return <p>Aucune version disponible.</p>
  if ('motif' in row) return <div><p>{row.motif} · {row.expense_date} · {row.deleted_at ? 'Supprimée' : 'Active'}</p><p>{data.categories.find(cat => cat.id === row.category_id)?.name ?? row.category_id} · {money(row.unit_price, data.settings.currency)} × {row.quantity} + {money(row.extra_fee, data.settings.currency)} = {money(row.total, data.settings.currency)}</p></div>
  if ('name' in row) return <p>{row.name} · {row.is_active ? 'Active' : 'Désactivée'}</p>
  return <p>{row.month_start.slice(0, 7)} · {money(row.budget_limit, data.settings.currency)} · seuils {row.warning_thresholds.join(', ')} %</p>
}
const labels: Record<Operation['status'], string> = { pending: 'En attente', sending: 'Envoi en cours', retry: 'Nouvelle tentative prévue', blocked: 'À corriger', conflict: 'Conflit à résoudre' }

export function Synchronization() {
  const { ledger, engine, sync, data } = useFinance()
  const [operations, setOperations] = useState<Operation[]>([]), [last, setLast] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState<{ id: string; choice: 'local' | 'remote'; revision: number } | null>(null)
  useEffect(() => {
    const sub = liveQuery(async () => ({ operations: await ledger.db.queue.orderBy('sequence').toArray(), last: (await ledger.db.metadata.get('last_sync'))?.value ?? '' })).subscribe({ next: value => { setOperations(value.operations); setLast(value.last) }, error: () => setError('Impossible de lire la file locale.') })
    return () => sub.unsubscribe()
  }, [ledger])
  async function confirm() {
    if (!confirmation || busy) return
    setBusy(true); setError('')
    try { await engine.resolve(confirmation.id, confirmation.choice, confirmation.revision); setConfirmation(null); void engine.run(true) }
    catch (error) { setError(error instanceof Error ? error.message : 'Résolution impossible.') }
    finally { setBusy(false) }
  }
  return <>
    <PageHeading title="Synchronisation" description="Vos saisies sont conservées sur cet appareil jusqu’à leur confirmation par le serveur." />
    <section className="panel"><p>{sync.message}</p><p>Dernière lecture complète : {last ? new Date(last).toLocaleString('fr-FR') : 'Pas encore effectuée'}</p><button className="primary-link" disabled={sync.phase === 'syncing'} onClick={() => { void engine.run(true) }}>Synchroniser maintenant</button><p><Link to="/compte">Sauvegarder ou restaurer mon carnet</Link></p>{sync.phase === 'auth' && <Link to="/connexion?renew=1">Renouveler ma connexion</Link>}</section>
    {error && <p role="alert">{error}</p>}
    {confirmation && <section className="panel"><h2>Confirmer votre choix</h2><p>{confirmation.choice === 'remote' ? 'La version serveur remplacera l’intention locale et ses modifications en attente pour cet élément.' : 'La dernière intention locale sera proposée au serveur. Si sa version a changé, un nouveau conflit sera affiché.'}</p><button className="primary-link" disabled={busy} onClick={() => { void confirm() }}>Confirmer la résolution</button><button className="secondary-button" disabled={busy} onClick={() => setConfirmation(null)}>Annuler</button></section>}
    {!operations.length ? <section className="panel"><h2>Aucune opération en attente</h2><p>Les prochains changements seront enregistrés ici avant leur envoi.</p></section> : operations.map(op => {
      const row = (op.entity === 'expenses' ? data.expenses : op.entity === 'categories' ? data.categories : data.budgets).find(row => row.id === op.entity_id)
      const root = !operations.some(prior => prior.entity === op.entity && prior.entity_id === op.entity_id && prior.sequence! < op.sequence!)
      const resolvable = root && (op.status === 'conflict' || op.status === 'blocked')
      const deleted = op.remote && 'deleted_at' in op.remote && Boolean(op.remote.deleted_at)
      return <section className="panel" key={op.operation_id}><h2>{labels[op.status]}</h2><RowSummary row={row} /><p>{op.last_error ?? (root ? 'Enregistrée sur cet appareil.' : 'Attend la confirmation de la modification précédente.')}</p>
        {op.status === 'retry' && op.next_retry_at && <p>Nouvel essai à partir de {new Date(op.next_retry_at).toLocaleTimeString('fr-FR')}.</p>}
        {resolvable && row && <><div className="chart-grid"><div><h3>Base connue</h3><RowSummary row={op.base} /></div><div><h3>Version serveur reçue</h3><RowSummary row={op.remote} /></div></div><p>Intention locale actuelle affichée ci-dessus. Les modifications suivantes du même élément seront incluses dans votre choix.</p>
          {op.entity === 'expenses' && <p><Link to={`/depenses/${op.entity_id}`}>Vérifier ou corriger la dépense</Link></p>}
          <button className="secondary-button" disabled={busy} onClick={() => setConfirmation({ id: op.operation_id, choice: 'remote', revision: row.local_revision })}>Choisir la version serveur</button>
          {!deleted && <button className="primary-link" disabled={busy} onClick={() => setConfirmation({ id: op.operation_id, choice: 'local', revision: row.local_revision })}>Proposer ma version locale</button>}
          {deleted && <p>Une dépense supprimée à distance ne peut pas être réactivée.</p>}</>}
      </section>
    })}
  </>
}
