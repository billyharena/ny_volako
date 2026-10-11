import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router'
import { useAuth } from './context'

type Mode = 'login' | 'register' | 'reset' | 'recover'
const titles: Record<Mode, string> = {
  login: 'Heureux de vous retrouver.', register: 'Votre compte personnel.',
  reset: 'Retrouver votre accès.', recover: 'Un nouveau mot de passe.',
}

export function AuthPage({ mode }: { mode: Mode }) {
  const { client, session, loading, error } = useAuth()
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ message: string; failed: boolean } | null>(null)
  const [completed, setCompleted] = useState(false)
  const callbackError = new URLSearchParams(window.location.search).has('error')
    || new URLSearchParams(window.location.hash.slice(1)).has('error')

  if (loading) return <p role="status">Vérification de votre session…</p>
  if (session && (mode === 'login' || mode === 'register' || completed)) return <Navigate to="/compte" replace />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!client || busy) return
    const form = event.currentTarget
    const values = new FormData(form)
    const email = String(values.get('email') ?? '').trim()
    const password = String(values.get('password') ?? '')
    if ((mode === 'register' || mode === 'recover') && password !== values.get('confirmation')) {
      setFeedback({ message: 'Les deux mots de passe doivent être identiques.', failed: true }); return
    }
    setBusy(true); setFeedback(null)
    try {
      const origin = window.location.origin
      const response = mode === 'login' ? await client.auth.signInWithPassword({ email, password })
        : mode === 'register' ? await client.auth.signUp({ email, password, options: { emailRedirectTo: `${origin}/connexion` } })
          : mode === 'reset' ? await client.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/recuperation` })
            : await client.auth.updateUser({ password })
      if (response.error) {
        const message = response.error.code === 'invalid_credentials' ? 'Adresse ou mot de passe incorrect.'
          : response.error.code === 'email_not_confirmed' ? 'Confirmez votre adresse avec le lien reçu par email.'
            : response.error.status === 429 ? 'Trop de tentatives. Patientez avant de réessayer.'
              : mode === 'recover' ? 'Le mot de passe n’a pas pu être modifié. Demandez un nouveau lien si nécessaire.'
                : 'La demande a échoué. Vérifiez votre connexion et réessayez.'
        setFeedback({ message, failed: true })
      } else {
        form.reset()
        if (mode === 'recover') setCompleted(true)
        setFeedback({ failed: false, message: mode === 'register'
          ? 'Si cette adresse peut être inscrite, un email de confirmation vous attend. Ouvrez-le dans ce navigateur.'
          : mode === 'reset' ? 'Si un compte correspond à cette adresse, vous recevrez un lien. Ouvrez-le dans ce navigateur.'
            : 'Votre demande a été enregistrée.' })
      }
    } catch { setFeedback({ message: 'Connexion impossible. Réessayez lorsque le réseau sera disponible.', failed: true }) }
    finally { setBusy(false) }
  }

  return <>
    <div className="page-heading"><p className="eyebrow">VOTRE ESPACE PERSONNEL</p><h1>{titles[mode]}</h1>
      <p>La connexion et la récupération du compte nécessitent Internet.</p></div>
    <section className="settings-card auth-card">
      {!client ? <><p role="status">Configurez les paramètres publics Supabase pour activer la connexion.</p><Link to="/configuration">Voir la configuration</Link></>
        : mode === 'recover' && !session ? <><p role="alert">Ce lien n’a pas ouvert de session. Il est peut-être expiré ou a été ouvert dans un autre navigateur.</p><Link to="/mot-de-passe-oublie">Demander un nouveau lien</Link></>
          : <>
            {(error || callbackError) && <p role="alert">{error ?? 'Le lien n’a pas pu être validé. Demandez un nouveau lien.'}</p>}
            <form onSubmit={event => { void submit(event) }} className="auth-form">
              {mode !== 'recover' && <label>Adresse email<input name="email" type="email" autoComplete="email" required maxLength={254} disabled={busy} /></label>}
              {mode !== 'reset' && <div><label htmlFor="auth-password">Mot de passe</label><input id="auth-password" name="password" type="password" aria-describedby={mode === 'login' ? undefined : 'password-help'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? 1 : 12} maxLength={128} required disabled={busy} />
                {mode !== 'login' && <span id="password-help" className="field-hint">Au moins 12 caractères.</span>}</div>}
              {(mode === 'register' || mode === 'recover') && <label>Confirmer le mot de passe<input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy} /></label>}
              {feedback && <p role={feedback.failed ? 'alert' : 'status'}>{feedback.message}</p>}
              <button className="primary-link" disabled={busy} type="submit">{busy ? 'Veuillez patienter…' : mode === 'login' ? 'Se connecter' : mode === 'register' ? 'Créer mon compte' : mode === 'reset' ? 'Recevoir un lien' : 'Enregistrer le mot de passe'}</button>
            </form>
            <div className="auth-links">{mode === 'login' ? <><Link to="/inscription">Créer un compte</Link><Link to="/mot-de-passe-oublie">Mot de passe oublié ?</Link></> : <Link to="/connexion">Retour à la connexion</Link>}</div>
          </>}
    </section>
  </>
}
