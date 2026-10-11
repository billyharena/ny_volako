import { Component } from 'react'
import type { ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="error-screen">
          <p className="eyebrow">NY VOLAKO</p>
          <h1>Une erreur a interrompu l’affichage.</h1>
          <p>Rechargez la page pour réessayer.</p>
          <button className="primary-link" onClick={() => window.location.reload()}>
            Recharger la page
          </button>
        </main>
      )
    }
    return this.props.children
  }
}
