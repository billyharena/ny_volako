import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from './context'
import { useFinance } from '../finance/context'

export function AccountPage() {
  const { client, session } = useAuth()
  const { data, ledger, engine } = useFinance()
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [exportedCount, setExportedCount] = useState(-1), [confirmed, setConfirmed] = useState(false)
  const [exportedRevision, setExportedRevision] = useState('')
  const [restoreFile, setRestoreFile] = useState<File | null>(null), [restoreConfirmed, setRestoreConfirmed] = useState(false), [restored, setRestored] = useState(false)
  async function exportData() {
    setBusy(true); setError(''); setConfirmed(false)
    try {
      const json = await ledger.exportRecovery()
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url; link.download = `ny-volako-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`
      document.body.append(link); link.click(); link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setExportedCount((JSON.parse(json) as { operations: unknown[] }).operations.length)
      setExportedRevision((JSON.parse(json) as { revision: string }).revision)
    } catch { setError('La sauvegarde n’a pas pu être préparée. Vos données sont conservées sur cet appareil.') }
    finally { setBusy(false) }
  }
  async function signOut() {
    if (!client || busy) return
    setBusy(true); setError('')
    let prepared = false
    try {
      await ledger.prepareSignOut(exportedCount, confirmed, exportedRevision)
      prepared = true
      await engine.pause()
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error) { await ledger.cancelSignOut(); engine.resume(); setError('La déconnexion a échoué. Réessayez. Les données sont conservées.') }
    } catch (error) {
      if (prepared) { try { await ledger.cancelSignOut(); engine.resume() } catch { /* Une session déjà fermée conserve son verrou. */ } }
      setError(error instanceof Error ? error.message : 'La déconnexion a échoué. Réessayez.')
    }
    finally { setBusy(false) }
  }
  async function restoreData() {
    if (!restoreFile || !restoreConfirmed || busy) return
    setBusy(true); setError(''); setRestored(false)
    try {
      if (restoreFile.size > 10_000_000) throw new Error('La sauvegarde dépasse 10 Mo.')
      await engine.restore(await restoreFile.text())
      setRestored(true); setRestoreConfirmed(false); void engine.run(true)
    } catch (error) { setError(error instanceof Error ? error.message : 'Restauration impossible.') }
    finally { setBusy(false) }
  }
  return <>
    <div className="page-heading"><p className="eyebrow">VOTRE ESPACE</p><h1>Mon compte</h1><p className="account-email">{session?.user.email}</p></div>
    <section className="settings-card"><h2>Un compte, vos données</h2><p role="status">Votre compte est prêt. Votre carnet est conservé sur cet appareil.</p><Link className="primary-link" to="/tableau-de-bord">Ouvrir mon carnet</Link>
      <dl className="settings-list"><div><dt>Devise</dt><dd>{data.settings.currency}</dd></div><div><dt>Fuseau du budget</dt><dd>{data.settings.timezone}</dd></div><div><dt>Opérations en attente</dt><dd>{data.pending}</dd></div></dl>
    </section>
    <section className="settings-card"><h2>Sauvegarde et déconnexion</h2><p>L’export JSON contient votre carnet et les opérations en attente. Conservez ce fichier dans un emplacement privé.</p>
      <button className="secondary-button" disabled={busy} onClick={() => { void exportData() }}>Exporter les données locales</button>
      {data.pending > 0 && <><p className="pending-warning">Synchronisez les {data.pending} opérations en attente, ou sauvegardez-les avant la déconnexion. Elles resteront sur cet appareil et seront accessibles après reconnexion au même compte.</p><Link to="/synchronisation">Voir les opérations et les conflits</Link>
        {exportedCount >= 0 && <label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />J’ai vérifié que le fichier de sauvegarde a été téléchargé.</label>}</>}
      {error && <p role="alert">{error}</p>}
      <button className="primary-link" type="button" disabled={busy} onClick={() => { void signOut() }}>{busy ? 'Veuillez patienter…' : 'Se déconnecter de cet appareil'}</button>
      <p className="field-hint">La déconnexion ferme l’accès dans l’application et conserve les données locales. IndexedDB n’est pas chiffré : sur un appareil partagé, utilisez un profil navigateur personnel.</p>
    </section>
    <section className="settings-card"><h2>Restaurer une sauvegarde</h2><p>La file actuelle doit être vide. Les opérations de la sauvegarde seront reprises avec leurs identifiants d’origine pour éviter les doublons. Les données déjà confirmées seront relues du serveur.</p><label>Fichier de sauvegarde JSON<input type="file" accept="application/json,.json" disabled={busy} onChange={event => { setRestoreFile(event.target.files?.[0] ?? null); setRestoreConfirmed(false); setRestored(false) }} /></label><label className="checkbox-label"><input type="checkbox" disabled={!restoreFile || busy} checked={restoreConfirmed} onChange={event => setRestoreConfirmed(event.target.checked)} />Je confirme que cette sauvegarde provient de mon compte et de ce serveur.</label><button className="primary-link" disabled={!restoreFile || !restoreConfirmed || busy || data.pending > 0} onClick={() => { void restoreData() }}>Restaurer les opérations</button>{restored && <p role="status">Sauvegarde restaurée. Consultez la synchronisation pour suivre les opérations.</p>}</section>
  </>
}
