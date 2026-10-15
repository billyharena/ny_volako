import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readEnvironment } from '../../config/environment'
import type { Database } from './database.types'

export type AppClient = SupabaseClient<Database>

const configuration = readEnvironment(import.meta.env)
// Preserve the SDK default key so accounts already connected in phase 5 stay connected.
export const authStorageKey = configuration.status === 'ready' ? `sb-${new URL(configuration.url).hostname.split('.')[0]}-auth-token` : null

export const supabase = configuration.status === 'ready'
  ? createClient<Database>(configuration.url, configuration.publicKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: authStorageKey! },
  })
  : null
