import { useEffect, useState } from 'react'
import { Link, Navigate, Outlet } from 'react-router'
import { liveQuery } from 'dexie'
import type { AppClient } from '../../data/remote/client'
import { readEnvironment } from '../../config/environment'
import { AccountDatabase } from '../../data/local/database'
import { initializeLocalAccount } from '../../data/remote/bootstrap'
import { Ledger } from '../../services/ledger'
import type { Snapshot } from '../../domain/finance'
import { useAuth } from '../auth/context'
import { FinanceContext } from './context'
import { BudgetAlerts } from './Alerts'
import { SyncEngine, type SyncState } from '../../sync/engine'
import { authSessionId, createTransport } from '../../sync/transport'

const config = readEnvironment(import.meta.env)

export function PrivateWorkspace() {
  const { session, client, loading } = useAuth()
  if (loading) return <p role="status">Vérification de votre session…</p>
  if (!session || !client) return <Navigate to="/connexion" replace />
  // Identifiant stable au rafraîchissement du JWT ; sert uniquement au verrou local.
  // L'autorisation distante reste entièrement contrôlée par Supabase/RLS.
  let sessionId: string
  try {
    sessionId = authSessionId(session.access_token)
  } catch { return <p role="alert">La session ne peut pas ouvrir le carnet local. Reconnectez-vous.</p> }
  return <LocalWorkspace key={`${session.user.id}:${sessionId}`} userId={session.user.id} sessionId={sessionId} client={client} />
}

function LocalWorkspace({ userId, sessionId, client }: { userId: string; sessionId: string; client: AppClient }) {
  const { session } = useAuth()
  const [state, setState] = useState<{ ledger: Ledger; data: Snapshot; engine: SyncEngine } | null>(null)
  const [sync, setSync] = useState<SyncState>({ phase: 'idle', message: 'Préparation de la synchronisation…' })
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [online, setOnline] = useState(navigator.onLine)
  const syncEngine = state?.engine
  useEffect(() => { void syncEngine?.run(true) }, [syncEngine, session?.access_token])
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  useEffect(() => {
    const db = new AccountDatabase(userId, config.status === 'ready' ? config.url : 'unconfigured')
    const ledger = new Ledger(db, sessionId)
    const controller = new AbortController()
    let active = true
    const engine = new SyncEngine(ledger, createTransport(client, db.source, config.status === 'ready' ? config.publicKey : '', userId, sessionId), value => { if (active) setSync(value) })
    let subscription: { unsubscribe(): void } | undefined
    void initializeLocalAccount(db, client, controller.signal).then(() => {
      if (!active) return
      subscription = liveQuery(() => ledger.snapshot()).subscribe({
        next: data => { if (active) setState({ ledger, data, engine }) },
        error: () => { if (active) setError('Le stockage local est indisponible. Vos saisies ne peuvent pas être enregistrées. Réessayez après avoir vérifié l’espace disponible et les autorisations du navigateur.') },
      })
      engine.start()
    }).catch(() => { if (active) setError('Impossible d’ouvrir le carnet local. Pour une première ouverture, vérifiez votre connexion et réessayez. Les données existantes sont conservées.') })
    return () => { active = false; controller.abort(); subscription?.unsubscribe(); ledger.deactivate(); void engine.stop().finally(() => db.close()) }
  }, [userId, sessionId, client, attempt])
  if (error) return <section className="settings-card"><h1>Carnet indisponible</h1><p role="alert">{error}</p><button className="primary-link" onClick={() => { setError(''); setState(null); setAttempt(n => n + 1) }}>Réessayer</button><p><Link to="/configuration">Vérifier la configuration</Link></p></section>
  if (!state) return <p role="status">Préparation du carnet local…</p>
  return <FinanceContext value={{ ...state, sync }}>
    <div className="local-banner"><span>{online ? 'Carnet sur cet appareil' : 'Hors ligne · carnet local'}</span><strong>{state.data.pending} opération{state.data.pending > 1 ? 's' : ''} en attente</strong><p aria-live="polite">{sync.message}</p><Link to="/synchronisation">Suivre la synchronisation</Link></div>
    <div className="workspace-links"><Link to="/tableau-de-bord">Vue d’ensemble</Link><Link to="/categories">Catégories</Link><Link to="/compte">Mon compte et sauvegarde</Link><Link className="primary-link" to="/depenses/nouvelle">+ Ajouter une dépense</Link></div>
    <BudgetAlerts />
    <Outlet />
  </FinanceContext>
}
