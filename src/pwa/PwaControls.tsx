import { useEffect, useState, useSyncExternalStore } from 'react'
import { applyUpdate, getPwaState, subscribePwa } from './client'

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

export function PwaControls() {
  const pwa = useSyncExternalStore(subscribePwa, getPwaState)
  const [install, setInstall] = useState<InstallEvent | null>(null)
  const [installed, setInstalled] = useState(() => window.matchMedia?.('(display-mode: standalone)').matches ?? false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [persistent, setPersistent] = useState<boolean | null>(null)
  useEffect(() => {
    const offer = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent) }
    const done = () => { setInstalled(true); setInstall(null) }
    window.addEventListener('beforeinstallprompt', offer)
    window.addEventListener('appinstalled', done)
    void navigator.storage?.persisted?.().then(setPersistent).catch(() => { /* Unsupported or denied. */ })
    return () => { window.removeEventListener('beforeinstallprompt', offer); window.removeEventListener('appinstalled', done) }
  }, [])
  async function installApp() {
    if (!install) return
    setBusy(true)
    try {
      await install.prompt()
      const choice = await install.userChoice
      setMessage(choice.outcome === 'accepted' ? 'Installation demandée au navigateur.' : 'Installation reportée. Vous pouvez continuer dans ce navigateur.')
    } catch { setMessage('Utilisez le menu de votre navigateur pour installer l’application.') }
    finally { setInstall(null); setBusy(false) }
  }
  async function persist() {
    setBusy(true)
    try {
      const granted = await navigator.storage?.persist?.()
      setPersistent(Boolean(granted))
      setMessage(granted ? 'Le navigateur a accordé le stockage persistant.' : 'Le navigateur n’a pas accordé la persistance. Synchronisez et exportez régulièrement vos données.')
    } catch { setMessage('La persistance est indisponible dans ce navigateur.') }
    finally { setBusy(false) }
  }
  return <details className="pwa-controls">
    <summary>Installer et utiliser hors ligne</summary>
    <div className="pwa-content">
      <p>{pwa.ready ? 'Application prête à démarrer hors ligne sur cet appareil.' : pwa.error ? 'Le démarrage hors ligne n’a pas pu être préparé. Vérifiez le stockage et rechargez en ligne.' : 'Le démarrage hors ligne sera disponible après le chargement complet de la version publiée.'}</p>
      <p>Connectez-vous une première fois avec Internet pour préparer votre carnet. Les dépenses enregistrées se synchronisent lorsque l’application est ouverte et la connexion disponible.</p>
      {installed ? <p>Ouverte comme application installée.</p> : install ? <button className="secondary-button" disabled={busy} onClick={() => { void installApp() }}>Installer Ny Volako</button> : <p>Pour installer : ouvrez le menu du navigateur et choisissez « Installer l’application ». Sur iPhone ou iPad, dans Safari : Partager → Sur l’écran d’accueil. Si cette option est absente, continuez dans le navigateur.</p>}
      <p>{persistent ? 'Stockage persistant accordé.' : 'Vous pouvez demander au navigateur de mieux conserver le carnet sur cet appareil.'} L’effacement des données du navigateur supprime aussi les saisies non synchronisées. Conservez des exports depuis « Mon compte ».</p>
      {!persistent && <button className="secondary-button" disabled={busy || !navigator.storage?.persist} onClick={() => { void persist() }}>Protéger le stockage local</button>}
      {message && <p role="status">{message}</p>}
    </div>
  </details>
}

export function UpdateNotice() {
  const { waiting } = useSyncExternalStore(subscribePwa, getPwaState)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  if (!waiting) return null
  return <section className="update-notice" aria-label="Mise à jour disponible">
    <p>Une nouvelle version est prête. Enregistrez ou fermez vos formulaires avant de l’ouvrir. Les dépenses et opérations en attente seront conservées.</p>
    <button className="secondary-button" disabled={busy} onClick={() => {
      setBusy(true); setError('')
      void applyUpdate().catch(error => { setError(error instanceof Error ? error.message : 'Mise à jour impossible. Réessayez.'); setBusy(false) })
    }}>{busy ? 'Préparation…' : 'Mettre à jour maintenant'}</button>
    {error && <p role="alert">{error}</p>}
  </section>
}
