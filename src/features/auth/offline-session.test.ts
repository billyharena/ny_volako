import { afterEach, describe, expect, it, vi } from 'vitest'
import { readOfflineSession } from './offline-session'

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })
describe('identité locale hors ligne', () => {
  const session = { access_token: `header.${btoa(JSON.stringify({ sub: 'account-a', session_id: 'session-a' }))}.signature`, refresh_token: 'refresh', token_type: 'bearer', expires_at: 1, user: { id: 'account-a' } }
  it('ouvre le carnet expiré hors ligne, sans servir de session en ligne', () => {
    localStorage.setItem('test-auth', JSON.stringify(session))
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    expect(readOfflineSession('test-auth')).toEqual(session)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    expect(readOfflineSession('test-auth')).toBeNull()
  })
  it('ne ressuscite pas une session effacée et rejette une identité incohérente', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    expect(readOfflineSession('test-auth')).toBeNull()
    localStorage.setItem('test-auth', JSON.stringify({ ...session, user: { id: 'account-b' } }))
    expect(readOfflineSession('test-auth')).toBeNull()
    localStorage.setItem('test-auth', '{invalide')
    expect(readOfflineSession('test-auth')).toBeNull()
  })
})
