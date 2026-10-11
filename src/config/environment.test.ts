import { describe, expect, it } from 'vitest'
import { assertPublicKeys, readEnvironment } from './environment'

const url = 'https://example.supabase.co'
const key = 'sb_publishable_public-test-key'
const jwt = (role: string) => `header.${btoa(JSON.stringify({ role }))}.signature`

describe('configuration publique', () => {
  it('bloque une clé privilégiée avant compilation, même sans URL', () => {
    expect(() => assertPublicKeys({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_test' })).toThrow(/compilation interrompue/)
  })
  it('vérifie aussi une ancienne clé masquée par une clé publishable', () => {
    expect(() => assertPublicKeys({ VITE_SUPABASE_PUBLISHABLE_KEY: key, VITE_SUPABASE_ANON_KEY: jwt('service_role') })).toThrow()
    expect(() => assertPublicKeys({ VITE_SUPABASE_PUBLISHABLE_KEY: key, VITE_SUPABASE_ANON_KEY: jwt('anon') })).not.toThrow()
    expect(() => assertPublicKeys({})).not.toThrow()
  })
  it('reste utilisable sans configuration et ne prétend pas être connecté', () => {
    expect(readEnvironment({}).status).toBe('missing')
    expect(readEnvironment({ VITE_SUPABASE_URL: url }).status).toBe('missing')
  })
  it('accepte une clé publishable sans déclarer le serveur vérifié', () => {
    expect(readEnvironment({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key }))
      .toMatchObject({ status: 'ready', url, publicKey: key, message: expect.stringContaining('reste à vérifier') })
  })
  it('accepte une ancienne clé anon et le serveur local', () => {
    expect(readEnvironment({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: jwt('anon') }).status).toBe('ready')
  })
  it.each(['sb_secret_do-not-expose', jwt('service_role'), 'malformed-key-do-not-expose'])('refuse une clé non publique', (publicKey) => {
    const result = readEnvironment({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: publicKey })
    expect(result.status).toBe('invalid')
    expect(JSON.stringify(result)).not.toContain(publicKey)
  })
  it.each(['http://example.supabase.co', 'javascript:alert(1)', 'https://name:password@example.supabase.co', 'https://example.supabase.co?secret=value', 'https://example.supabase.co/rest/v1'])('refuse une URL dangereuse ou non racine', (input) => {
    expect(readEnvironment({ VITE_SUPABASE_URL: input, VITE_SUPABASE_PUBLISHABLE_KEY: key }).status).toBe('invalid')
  })
})
