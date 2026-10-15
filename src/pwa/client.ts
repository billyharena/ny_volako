import { cancelUpdate, pauseForUpdate } from './update-gate'

export type PwaState = { ready: boolean; waiting: boolean; error: boolean }
let registration: ServiceWorkerRegistration | undefined
let state: PwaState = { ready: false, waiting: false, error: false }
const listeners = new Set<() => void>()
function report(change: Partial<PwaState>) { state = { ...state, ...change }; listeners.forEach(listener => listener()) }
export const getPwaState = () => state
export function subscribePwa(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }

export function startPwa() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(reg => {
    registration = reg
    const inspect = () => report({ ready: Boolean(reg.active), waiting: Boolean(reg.waiting), error: false })
    inspect()
    reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', inspect))
    // An already-installing worker might have been discovered before the listener was attached.
    reg.installing?.addEventListener('statechange', inspect)
    void navigator.serviceWorker.ready.then(inspect)
    const check = () => { if (navigator.onLine && document.visibilityState === 'visible') void reg.update().catch(() => { /* Offline readiness remains valid on update failure. */ }) }
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', check)
    window.setInterval(check, 60 * 60 * 1000)
  }).catch(() => report({ error: true }))
}

export async function applyUpdate() {
  if (document.querySelector('form, [aria-busy="true"]')) throw new Error('Enregistrez ou fermez le formulaire et terminez les opérations en cours avant de mettre à jour.')
  const worker = registration?.waiting
  if (!worker) throw new Error('La mise à jour n’est plus en attente. Fermez puis rouvrez l’application.')
  const root = document.getElementById('root')
  if (root) root.inert = true
  try {
    await pauseForUpdate()
    await new Promise<void>((resolve, reject) => {
      const channel = new MessageChannel()
      const timeout = window.setTimeout(() => finish(new Error('La mise à jour n’a pas répondu. Réessayez.')), 15_000)
      const finish = (error?: Error) => {
        window.clearTimeout(timeout); channel.port1.close(); worker.removeEventListener('statechange', inspect)
        if (error) reject(error); else resolve()
      }
      const inspect = () => {
        if (worker.state === 'activated') finish()
        else if (worker.state === 'redundant') finish(new Error('La mise à jour a échoué. Vos données sont conservées.'))
      }
      worker.addEventListener('statechange', inspect)
      channel.port1.onmessage = event => {
        if (!event.data.allowed) finish(new Error('Fermez les autres onglets et fenêtres de Ny Volako, puis réessayez.'))
      }
      worker.postMessage({ type: 'ACTIVATE_SAFELY' }, [channel.port2])
    })
    window.location.reload()
  } catch (error) {
    cancelUpdate()
    if (root) root.inert = false
    throw error
  }
}
