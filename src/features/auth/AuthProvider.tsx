import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { authStorageKey, supabase, type AppClient } from '../../data/remote/client'
import { AuthContext } from './context'
import { readOfflineSession } from './offline-session'

export function AuthProvider({ children, client = supabase }: { children: ReactNode; client?: AppClient | null }) {
  const [state, setState] = useState<{ session: Session | null; loading: boolean; error: string | null }>(() => {
    const session = client === supabase ? readOfflineSession(authStorageKey) : null
    return { session, loading: client !== null && !session, error: null }
  })
  useEffect(() => {
    if (!client) return
    let active = true
    let revision = 0
    const localFallback = () => client === supabase ? readOfflineSession(authStorageKey) : null
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      revision++
      // Aucun appel async au SDK dans ce callback : son verrou Auth est encore détenu.
      if (active) setState({ session: session ?? (event === 'INITIAL_SESSION' ? localFallback() : null), loading: false, error: null })
    })
    const initialRevision = revision
    void client.auth.getSession().then(({ data, error }) => {
      if (active && revision === initialRevision) {
        const session = data.session ?? localFallback()
        setState({ session, loading: false, error: error && !session ? 'La session n’a pas pu être restaurée. Reconnectez-vous.' : null })
      }
    }).catch(() => {
      if (active && revision === initialRevision) {
        const session = localFallback()
        setState({ session, loading: false, error: session ? null : 'La session est indisponible. Réessayez.' })
      }
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [client])
  return <AuthContext value={{ client, ...state }}>{children}</AuthContext>
}
