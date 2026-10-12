import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from './context'
import { useFinance } from '../finance/context'

export function AccountPage() {
  const { client, session } = useAuth()
  const { data, ledger } = useFinance()
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [exportedCount, setExportedCount] = useState(-1), [confirmed, setConfirmed] = useState(false)
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
    } catch { setError('La sauvegarde n’a pas pu être préparée. Vos données sont conservées sur cet appareil.') }
    finally { setBusy(false) }
  }
  async function signOut() {
    if (!client || busy) return
    setBusy(true); setError('')
    let prepared = false
    try {
      await ledger.prepareSignOut(exportedCount, confirmed)
      prepared = true
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error) { await ledger.cancelSignOut(); setError('La déconnexion a échoué. Réessayez. Les données sont conservées.') }
    } catch (error) {
      if (prepared) { try { await ledger.cancelSignOut() } catch { /* Une session déjà fermée conserve son verrou. */ } }
      setError(error instanceof Error ? error.message : 'La déconnexion a échoué. Réessayez.')
    }
    finally { setBusy(false) }
  }
  return <>
    <div className="page-heading"><p className="eyebrow">VOTRE ESPACE</p><h1>Mon compte</h1><p className="account-email">{session?.user.email}</p></div>
    <section className="settings-card"><h2>Un compte, vos données</h2><p role="status">Votre compte est prêt. Votre carnet est conservé sur cet appareil.</p><Link className="primary-link" to="/tableau-de-bord">Ouvrir mon carnet</Link>
      <dl className="settings-list"><div><dt>Devise</dt><dd>{data.settings.currency}</dd></div><div><dt>Fuseau du budget</dt><dd>{data.settings.timezone}</dd></div><div><dt>Opérations en attente</dt><dd>{data.pending}</dd></div></dl>
    </section>
    <section className="settings-card"><h2>Sauvegarde et déconnexion</h2><p>L’export JSON contient votre carnet et les opérations en attente. Conservez ce fichier dans un emplacement privé. La restauration automatisée sera ajoutée avec la synchronisation.</p>
      <button className="secondary-button" disabled={busy} onClick={() => { void exportData() }}>Exporter les données locales</button>
      {data.pending > 0 && <><p className="pending-warning">La synchronisation réseau n’est pas encore active. Sauvegardez les {data.pending} opérations en attente avant la déconnexion. Elles resteront sur cet appareil et seront accessibles après reconnexion au même compte.</p>
        {exportedCount >= 0 && <label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />J’ai vérifié que le fichier de sauvegarde a été téléchargé.</label>}</>}
      {error && <p role="alert">{error}</p>}
      <button className="primary-link" type="button" disabled={busy} onClick={() => { void signOut() }}>{busy ? 'Veuillez patienter…' : 'Se déconnecter de cet appareil'}</button>
      <p className="field-hint">La déconnexion ferme l’accès dans l’application et conserve les données locales. IndexedDB n’est pas chiffré : sur un appareil partagé, utilisez un profil navigateur personnel.</p>
    </section>
  </>
}
