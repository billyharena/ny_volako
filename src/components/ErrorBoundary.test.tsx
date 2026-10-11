import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function BrokenView(): never {
  throw new Error('Simulated rendering failure')
}

describe('erreur de rendu', () => {
  it('affiche une action de récupération plutôt qu’une page blanche', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<ErrorBoundary><BrokenView /></ErrorBoundary>)
    expect(screen.getByRole('heading', { name: 'Une erreur a interrompu l’affichage.' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Recharger la page' })).toBeVisible()
  })
})
