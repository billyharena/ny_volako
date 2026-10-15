import type { Session } from '@supabase/supabase-js'

// This is only a local UI identity, never authorization for a remote request.
// Read the SDK's existing storage; do not duplicate refresh tokens in another store.
export function readOfflineSession(storageKey: string | null): Session | null {
  if (!storageKey || navigator.onLine) return null
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Session | null
    if (!value || typeof value.access_token !== 'string' || typeof value.refresh_token !== 'string'
      || value.token_type !== 'bearer' || !Number.isFinite(value.expires_at)
      || typeof value.user?.id !== 'string') return null
    const payload = value.access_token.split('.')[1]
    if (!payload) return null
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string; session_id?: string }
    if (claims.sub !== value.user.id || !claims.session_id) return null
    return value
  } catch { return null }
}
