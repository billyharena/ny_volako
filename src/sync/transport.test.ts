import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppClient } from '../data/remote/client'
import type { Operation } from '../data/local/database'
import { createTransport } from './transport'

const token = `header.${btoa(JSON.stringify({ session_id: 'session-a' }))}.signature`
function fixture() {
  const auth = {
    getSession: vi.fn(async () => ({ data: { session: { user: { id: 'account-a' }, access_token: token } }, error: null })),
    getUser: vi.fn(async () => ({ data: { user: { id: 'account-a' } }, error: null })),
  }
  const transport = createTransport({ auth } as unknown as AppClient, 'http://localhost:54321', 'public-key', 'account-a', 'session-a')
  return { auth, transport, signal: new AbortController().signal }
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('transport Supabase', () => {
  it('vérifie l’identité distante puis conserve le jeton de A si le SDK passe à B', async () => {
    const { auth, transport, signal } = fixture()
    const request = vi.fn(async () => new Response('[]', { status: 200 })); vi.stubGlobal('fetch', request)
    await transport.authorize(signal)
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'account-b' }, access_token: 'other-token' } }, error: null })
    await transport.page('expenses', undefined, signal)
    expect(auth.getUser).toHaveBeenCalledWith(token)
    expect(request.mock.calls[0]).toBeDefined()
    const options = (request.mock.calls as unknown as [string, RequestInit][])[0]![1]
    expect((options.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`)
    await expect(transport.authorize(signal)).rejects.toMatchObject({ kind: 'auth' })
  })
  it('classe les réponses Auth, permanentes et temporaires avec Retry-After', async () => {
    const { transport, signal } = fixture(); await transport.authorize(signal)
    const request = vi.fn(); vi.stubGlobal('fetch', request)
    request.mockResolvedValueOnce(new Response('{}', { status: 401 }))
    await expect(transport.page('expenses', undefined, signal)).rejects.toMatchObject({ kind: 'auth' })
    request.mockResolvedValueOnce(new Response('private server details', { status: 403 }))
    await expect(transport.page('expenses', undefined, signal)).rejects.toMatchObject({ kind: 'blocked' })
    request.mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '65' } }))
    await expect(transport.page('expenses', undefined, signal)).rejects.toMatchObject({ kind: 'retry', retryAfter: 65_000 })
    request.mockResolvedValueOnce(new Response('broken-json', { status: 200 }))
    await expect(transport.page('expenses', undefined, signal)).rejects.toMatchObject({ kind: 'retry' })
  })
  it('refuse une dépendance sans version et interrompt une autorisation en attente', async () => {
    const { auth, transport } = fixture()
    const controller = new AbortController()
    await expect(transport.apply({ base_version: null } as Operation, controller.signal)).rejects.toMatchObject({ kind: 'blocked' })
    auth.getSession.mockImplementation(() => new Promise(() => {}))
    const pending = transport.authorize(controller.signal); controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
