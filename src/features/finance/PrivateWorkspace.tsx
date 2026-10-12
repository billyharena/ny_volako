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

const config = readEnvironment(import.meta.env)

export function PrivateWorkspace() {
  const { session, client, loading } = useAuth()
  if (loading) return <p role="status">Vérification de votre session…</p>
  if (!session || !client) return <Navigate to="/connexion" replace />
  // Identifiant stable au rafraîchissement du JWT ; sert uniquement au verrou local.
  // L'autorisation distante reste entièrement contrôlée par Supabase/RLS.
  let sessionId: string
  try {
    const part = session.access_token.split('.')[1]!
    const claims: unknown = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
    if (!claims || typeof claims !== 'object' || !('session_id' in claims) || typeof claims.session_id !== 'string') throw new Error('Session invalide')
    sessionId = claims.session_id
  } catch { return <p role="alert">La session ne peut pas ouvrir le carnet local. Reconnectez-vous.</p> }
  return <LocalWorkspace key={`${session.user.id}:${sessionId}`} userId={session.user.id} sessionId={sessionId} client={client} />
}

function LocalWorkspace({ userId, sessionId, client }: { userId: string; sessionId: string; client: AppClient }) {
  const [state, setState] = useState<{ ledger: Ledger; data: Snapshot } | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [online, setOnline] = useState(navigator.onLine)
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
    let subscription: { unsubscribe(): void } | undefined
    void initializeLocalAccount(db, client, controller.signal).then(() => {
      if (!active) return
      subscription = liveQuery(() => ledger.snapshot()).subscribe({
        next: data => { if (active) setState({ ledger, data }) },
        error: () => { if (active) setError('Le stockage local est indisponible. Vos saisies ne peuvent pas être enregistrées. Réessayez après avoir vérifié l’espace disponible et les autorisations du navigateur.') },
      })
    }).catch(() => { if (active) setError('Impossible d’ouvrir le carnet local. Pour une première ouverture, vérifiez votre connexion et réessayez. Les données existantes sont conservées.') })
    return () => { active = false; controller.abort(); subscription?.unsubscribe(); ledger.deactivate(); db.close() }
  }, [userId, sessionId, client, attempt])
  if (error) return <section className="settings-card"><h1>Carnet indisponible</h1><p role="alert">{error}</p><button className="primary-link" onClick={() => { setError(''); setState(null); setAttempt(n => n + 1) }}>Réessayer</button><p><Link to="/configuration">Vérifier la configuration</Link></p></section>
  if (!state) return <p role="status">Préparation du carnet local…</p>
  return <FinanceContext value={state}>
    <div className="local-banner"><span>{online ? 'Carnet sur cet appareil' : 'Hors ligne · carnet local'}</span><strong>{state.data.pending} opération{state.data.pending > 1 ? 's' : ''} en attente</strong><p>Enregistrement local actif. L’envoi vers le serveur sera activé à la phase 5.</p></div>
    <div className="workspace-links"><Link to="/tableau-de-bord">Vue d’ensemble</Link><Link to="/categories">Catégories</Link><Link to="/compte">Mon compte et sauvegarde</Link><Link className="primary-link" to="/depenses/nouvelle">+ Ajouter une dépense</Link></div>
    <BudgetAlerts />
    <Outlet />
  </FinanceContext>
}
