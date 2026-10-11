import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import type { AppClient } from '../../data/remote/client'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider } from './AuthProvider'
import { AuthContext, useAuth } from './context'
import { AuthPage } from './AuthPage'
import { App } from '../../app/App'

function SessionProbe() {
  const { session, loading } = useAuth()
  return <p>{loading ? 'chargement' : session?.user.id ?? 'déconnecté'}</p>
}

describe('authentification', () => {
  it('ignore une restauration tardive après la déconnexion', async () => {
    let callback: (event: AuthChangeEvent, session: Session | null) => void = () => undefined
    let resolveInitial: (value: unknown) => void = () => undefined
    const unsubscribe = vi.fn()
    const client = { auth: {
      onAuthStateChange: vi.fn(fn => { callback = fn; return { data: { subscription: { unsubscribe } } } }),
      getSession: vi.fn(() => new Promise(resolve => { resolveInitial = resolve })),
    } } as unknown as AppClient
    const { unmount } = render(<AuthProvider client={client}><SessionProbe /></AuthProvider>)
    expect(screen.getByText('chargement')).toBeVisible()
    act(() => { callback('SIGNED_OUT', null) })
    await act(async () => { resolveInitial({ data: { session: { user: { id: 'ancien-compte' } } }, error: null }) })
    expect(screen.getByText('déconnecté')).toBeVisible()
    expect(screen.queryByText('ancien-compte')).not.toBeInTheDocument()
    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('protège une route privée sans session', async () => {
    render(<MemoryRouter initialEntries={['/compte']}><App /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Heureux de vous retrouver.' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /déconnecter/ })).not.toBeInTheDocument()
  })

  it('valide la confirmation avant de demander une inscription', async () => {
    const signUp = vi.fn()
    const client = { auth: { signUp } } as unknown as AppClient
    render(<AuthContext value={{ client, session: null, loading: false, error: null }}><MemoryRouter><AuthPage mode="register" /></MemoryRouter></AuthContext>)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Adresse email'), 'test@example.test')
    await user.type(screen.getByLabelText(/^Mot de passe/), 'phrase-secrete-123')
    await user.type(screen.getByLabelText('Confirmer le mot de passe'), 'autre-phrase-123')
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }))
    expect(screen.getByRole('alert')).toHaveTextContent('identiques')
    expect(signUp).not.toHaveBeenCalled()
  })

  it('affiche une erreur de connexion sans exposer le détail serveur', async () => {
    const client = { auth: { signInWithPassword: vi.fn().mockResolvedValue({ error: { code: 'invalid_credentials', message: 'internal detail' } }) } } as unknown as AppClient
    render(<AuthContext value={{ client, session: null, loading: false, error: null }}><MemoryRouter><AuthPage mode="login" /></MemoryRouter></AuthContext>)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Adresse email'), 'test@example.test')
    await user.type(screen.getByLabelText('Mot de passe'), 'incorrect')
    await user.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Adresse ou mot de passe incorrect.')
    expect(screen.queryByText('internal detail')).not.toBeInTheDocument()
  })
})
