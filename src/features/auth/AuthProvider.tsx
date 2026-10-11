import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, type AppClient } from '../../data/remote/client'
import { AuthContext } from './context'

export function AuthProvider({ children, client = supabase }: { children: ReactNode; client?: AppClient | null }) {
  const [state, setState] = useState<{ session: Session | null; loading: boolean; error: string | null }>({
    session: null, loading: client !== null, error: null,
  })
  useEffect(() => {
    if (!client) return
    let active = true
    let revision = 0
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      revision++
      // Aucun appel async au SDK dans ce callback : son verrou Auth est encore détenu.
      if (active) setState({ session, loading: false, error: null })
    })
    const initialRevision = revision
    void client.auth.getSession().then(({ data, error }) => {
      if (active && revision === initialRevision) {
        setState({ session: data.session, loading: false, error: error ? 'La session n’a pas pu être restaurée. Reconnectez-vous.' : null })
      }
    }).catch(() => {
      if (active && revision === initialRevision) setState({ session: null, loading: false, error: 'La session est indisponible. Réessayez.' })
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [client])
  return <AuthContext value={{ client, ...state }}>{children}</AuthContext>
}
