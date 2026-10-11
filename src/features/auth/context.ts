import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { AppClient } from '../../data/remote/client'

export type AuthState = {
  client: AppClient | null
  session: Session | null
  loading: boolean
  error: string | null
}
export const AuthContext = createContext<AuthState>({ client: null, session: null, loading: false, error: null })
export function useAuth() { return useContext(AuthContext) }
