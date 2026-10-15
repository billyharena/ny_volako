import { spawnSync } from 'node:child_process'

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const status = spawnSync(pnpm, ['exec', 'supabase', 'status', '-o', 'json'], {
  encoding: 'utf8', shell: process.platform === 'win32',
})
if (status.status !== 0) throw new Error('Démarrez Supabase local avant ces tests.')
const configuration = JSON.parse(status.stdout)
if (configuration.API_URL !== 'http://127.0.0.1:54321' || !configuration.PUBLISHABLE_KEY?.startsWith('sb_publishable_')) {
  throw new Error('Ces tests exigent Supabase local sur 127.0.0.1:54321 et sa clé publique.')
}
// Les clés privilégiées du statut ne sont ni affichées ni transmises au navigateur.
const env = {
  ...process.env,
  VITE_SUPABASE_URL: configuration.API_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: configuration.PUBLISHABLE_KEY,
  LOCAL_AUTH_E2E: '1',
}
for (const args of [['build'], ['test:e2e'], ['test:pwa']]) {
  const result = spawnSync(pnpm, args, { env, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
