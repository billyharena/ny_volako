import type { Operation } from '../data/local/database'
import type { AppClient } from '../data/remote/client'

export class SyncFailure extends Error {
  constructor(readonly kind: 'auth' | 'retry' | 'blocked', readonly label: string, readonly retryAfter = 0) { super(label) }
}
export interface Transport {
  authorize(signal: AbortSignal): Promise<void>
  apply(operation: Operation, signal: AbortSignal): Promise<unknown>
  page(entity: string, after: string | undefined, signal: AbortSignal): Promise<unknown>
}
export function authSessionId(token: string): string {
  const part = token.split('.')[1]
  if (!part) throw new SyncFailure('auth', 'Reconnectez-vous pour synchroniser.')
  const claims: unknown = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
  if (!claims || typeof claims !== 'object' || !('session_id' in claims) || typeof claims.session_id !== 'string') throw new SyncFailure('auth', 'Reconnectez-vous pour synchroniser.')
  return claims.session_id
}
export function retryDelay(attempt: number, retryAfter = 0, random = Math.random()): number {
  return Math.max(retryAfter, Math.min(300_000, 1000 * 2 ** Math.min(attempt, 9) * (0.75 + random * 0.5)))
}
function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')) }
    const timer = setTimeout(() => { cleanup(); reject(new SyncFailure('retry', 'La vérification de session prend trop de temps. Réessayez.')) }, 15_000)
    signal.addEventListener('abort', abort, { once: true })
    work.then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
  })
}
export function createTransport(client: AppClient, url: string, publicKey: string, userId: string, sessionId: string): Transport {
  let token = ''
  async function rpc(name: string, args: object, signal: AbortSignal) {
    signal.throwIfAborted()
    let response: Response
    try {
      response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
        method: 'POST', headers: { apikey: publicKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args), signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      })
    } catch { throw new SyncFailure('retry', 'Connexion interrompue. Une nouvelle tentative est prévue.') }
    if (response.status === 401) throw new SyncFailure('auth', 'Session expirée. Reconnectez-vous pour synchroniser.')
    if (response.status === 429 || response.status >= 500 || response.status === 408) {
      const header = response.headers.get('Retry-After') ?? ''
      const delay = /^\d+$/.test(header) ? Number(header) * 1000 : Math.max(0, Date.parse(header) - Date.now()) || 0
      throw new SyncFailure('retry', 'Serveur temporairement indisponible. Une nouvelle tentative est prévue.', delay)
    }
    if (!response.ok) throw new SyncFailure('blocked', 'Modification refusée par le serveur. Vérifiez les valeurs et les catégories avant de réessayer.')
    try { return await response.json() as unknown } catch { throw new SyncFailure('retry', 'Réponse incomplète. Une nouvelle tentative est prévue.') }
  }
  return {
    async authorize(signal) {
      const { data, error } = await bounded(client.auth.getSession(), signal)
      signal.throwIfAborted()
      if (error || !data.session) throw new SyncFailure('auth', 'Reconnectez-vous pour synchroniser. Les saisies locales sont conservées.')
      if (data.session.user.id !== userId || authSessionId(data.session.access_token) !== sessionId) throw new SyncFailure('auth', 'La session a changé. Rouvrez votre carnet.')
      const result = await bounded(client.auth.getUser(data.session.access_token), signal)
      signal.throwIfAborted()
      if (result.error) throw new SyncFailure(result.error.status && result.error.status >= 400 && result.error.status < 500 ? 'auth' : 'retry', 'La session distante ne peut pas être vérifiée. Les données locales sont conservées.')
      if (result.data.user?.id !== userId) throw new SyncFailure('auth', 'La session distante ne correspond pas au carnet.')
      // Capturer le jeton : un changement de compte du SDK ne peut pas réattribuer une requête en vol.
      token = data.session.access_token
    },
    async apply(op, signal) {
      if (op.base_version === null) throw new SyncFailure('blocked', 'Une opération précédente doit être confirmée.')
      return rpc('apply_change', { p_operation_id: op.operation_id, p_entity: op.entity, p_entity_id: op.entity_id, p_kind: op.kind, p_base_version: op.base_version, p_payload: op.payload }, signal)
    },
    page(entity, after, signal) { return rpc('read_account_page', { p_entity: entity, p_limit: 500, ...(after ? { p_after: after } : {}) }, signal) },
  }
}
