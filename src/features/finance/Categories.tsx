import { useState, type FormEvent } from 'react'
import type { Category } from '../../domain/finance'
import { useFinance } from './context'
import { PageHeading } from './shared'
import { fieldsFrom } from './form-helpers'

export function Categories() {
  const { data } = useFinance()
  return <><PageHeading title="Mes catégories" description="Ajoutez vos repères. Désactiver une catégorie conserve ses dépenses dans l’historique." />
    <CategoryForm />
    <div className="category-grid">{[...data.categories].sort((a, b) => a.name.localeCompare(b.name, 'fr')).map(category => <CategoryForm key={category.id} category={category} />)}</div>
  </>
}
function CategoryForm({ category }: { category?: Category }) {
  const { ledger } = useFinance()
  const [baseline, setBaseline] = useState(category)
  const [name, setName] = useState(category?.name ?? '')
  const [active, setActive] = useState(category?.is_active ?? true)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return
    setBusy(true); setError(''); setSaved(false)
    try { const row = await ledger.saveCategory(name, active, baseline); if (category) setBaseline(row); setSaved(true); if (!category) setName('') }
    catch (error) { setError(Object.values(fieldsFrom(error))[0] ?? 'Enregistrement impossible.') }
    finally { setBusy(false) }
  }
  const id = category?.id ?? 'new'
  return <form className="panel ledger-form" onSubmit={e => { void submit(e) }} noValidate>
    <h2>{category ? category.name : 'Nouvelle catégorie'}</h2>
    <fieldset disabled={busy}><label htmlFor={`category-${id}`}>Nom de la catégorie</label><input id={`category-${id}`} maxLength={80} required value={name} onChange={e => setName(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? `category-error-${id}` : undefined} />
      {category && <label className="checkbox-label"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />Catégorie active</label>}
      <button className="primary-link" type="submit">{busy ? 'Enregistrement…' : category ? 'Enregistrer la catégorie' : 'Ajouter la catégorie'}</button>
    </fieldset>
    {error && <p id={`category-error-${id}`} role="alert">{error}</p>}{saved && <p role="status">Catégorie enregistrée sur cet appareil.</p>}
    {category && <p className="field-hint">{category.is_active ? 'Disponible pour les nouvelles dépenses.' : 'Désactivée · historique conservé.'}</p>}
  </form>
}
