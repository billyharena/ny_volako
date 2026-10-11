import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('socle de navigation', () => {
  it('présente honnêtement la phase et ouvre la configuration', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><App /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Un peu plus de clarté')
    expect(screen.getByText(/ne permet pas encore de saisir des dépenses/)).toBeVisible()
    await user.click(screen.getByRole('link', { name: 'Voir la configuration' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Configuration' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent(/prochaine étape|reste à vérifier|invalide/)
  })
  it('permet de retrouver l’accueil depuis une route inconnue', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/inconnue']}><App /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Reprenons par l’accueil.' })).toBeVisible()
    await user.click(screen.getByRole('link', { name: 'Retour à l’accueil' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Un peu plus de clarté')
  })
})
