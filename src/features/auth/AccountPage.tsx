import { useEffect, useState } from 'react'
import { Navigate } from 'react-router'
import type { AppClient } from '../../data/remote/client'
import { useAuth } from './context'

export function AccountPage() {
  const { session, client, loading } = useAuth()
  if (loading) return <p role="status">Vérification de votre session…</p>
  if (!session || !client) return <Navigate to="/connexion" replace />
  // Remonter le composant lors d'un changement d'identité invalide les anciennes réponses.
  return <Account key={session.user.id} client={client} email={session.user.email ?? ''} />
}

function Account({ client, email }: { client: AppClient; email: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    void Promise.resolve(client.rpc('initialize_account').abortSignal(controller.signal)).then(({ error }) => {
      if (active) setState(error ? 'error' : 'ready')
    }).catch(() => { if (active) setState('error') })
    return () => { active = false; controller.abort() }
  }, [client, attempt])

  async function signOut() {
    setSigningOut(true); setError(null)
    try {
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error) setError('La déconnexion a échoué. Réessayez.')
    } catch { setError('La déconnexion a échoué. Réessayez.') }
    finally { setSigningOut(false) }
  }
  return <>
    <div className="page-heading"><p className="eyebrow">VOTRE ESPACE</p><h1>Mon compte</h1><p className="account-email">{email}</p></div>
    <section className="settings-card">
      <h2>Un compte, vos données</h2>
      <p role="status">{state === 'loading' ? 'Préparation de votre compte…' : state === 'ready' ? 'Votre compte est prêt. Vos paramètres et catégories personnelles sont enregistrés.' : 'Le serveur est inaccessible ou la préparation a échoué. Vos données existantes sont conservées.'}</p>
      {state === 'error' && <button type="button" onClick={() => { setState('loading'); setAttempt(value => value + 1) }}>Réessayer</button>}
      <p>La saisie des dépenses et la consultation hors ligne arrivent à la prochaine phase.</p>
      {error && <p role="alert">{error}</p>}
      <button className="primary-link" type="button" disabled={signingOut} onClick={() => { void signOut() }}>{signingOut ? 'Déconnexion…' : 'Se déconnecter de cet appareil'}</button>
    </section>
  </>
}
