import type { ReactNode } from 'react'

export function Field({ name, label, error, children }: { name: string; label: string; error?: string | undefined; children: ReactNode }) {
  return <div className="form-field"><label htmlFor={name}>{label}</label>{children}{error && <p id={`${name}-error`} className="field-error">{error}</p>}</div>
}
export function PageHeading({ title, description }: { title: string; description: string }) {
  return <div className="page-heading"><p className="eyebrow">MON CARNET</p><h1>{title}</h1><p>{description}</p></div>
}
