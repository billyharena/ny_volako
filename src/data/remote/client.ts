import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readEnvironment } from '../../config/environment'
import type { Database } from './database.types'

export type AppClient = SupabaseClient<Database>

const configuration = readEnvironment(import.meta.env)

export const supabase = configuration.status === 'ready'
  ? createClient<Database>(configuration.url, configuration.publicKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  : null
