import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './app/App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthProvider } from './features/auth/AuthProvider'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Point de montage de l’application introuvable.')

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider><App /></AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
