export type PublicEnvironment = {
  VITE_SUPABASE_URL?: string | undefined
  VITE_SUPABASE_PUBLISHABLE_KEY?: string | undefined
  VITE_SUPABASE_ANON_KEY?: string | undefined
}

export type EnvironmentStatus =
  | { status: 'missing'; message: string }
  | { status: 'invalid'; message: string }
  | { status: 'ready'; url: string; publicKey: string; message: string }

// This checks configuration shape, never server availability or authentication.
export function readEnvironment(env: PublicEnvironment): EnvironmentStatus {
  const url = env.VITE_SUPABASE_URL?.trim()
  const publicKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
    || env.VITE_SUPABASE_ANON_KEY?.trim()

  if (!url || !publicKey) {
    return { status: 'missing', message: 'La connexion au compte sera configurée à la prochaine étape.' }
  }

  try {
    const parsed = new URL(url)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    if (
      (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:'))
      || parsed.username || parsed.password || parsed.search || parsed.hash
      || parsed.pathname !== '/'
    ) throw new Error('Invalid URL')

    if (!isPublicKey(publicKey)) throw new Error('Invalid public key')

    return {
      status: 'ready',
      url: parsed.origin,
      publicKey,
      message: 'Paramètres publics présents. La connexion au serveur reste à vérifier.',
    }
  } catch {
    return { status: 'invalid', message: 'La configuration Supabase est invalide. Vérifiez les variables publiques.' }
  }
}

// Runs before Vite transforms the frontend: a rejected key must not enter dist.
export function assertPublicKeys(env: PublicEnvironment): void {
  for (const value of [env.VITE_SUPABASE_PUBLISHABLE_KEY, env.VITE_SUPABASE_ANON_KEY]) {
    if (value?.trim() && !isPublicKey(value.trim())) {
      throw new Error('Clé Supabase non publique ou invalide : compilation interrompue. Vérifiez les variables VITE_SUPABASE_* sans utiliser de clé secrète.')
    }
  }
}

function isPublicKey(key: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true
  // Legacy JWTs are accepted only with the anon role; service_role is rejected.
  const parts = key.split('.')
  if (parts.length !== 3 || !parts.every(Boolean)) return false
  try {
    const payload = parts[1]
    if (!payload) return false
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const decoded: unknown = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')))
    return typeof decoded === 'object' && decoded !== null
      && 'role' in decoded && decoded.role === 'anon'
  } catch {
    return false
  }
}
