import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './app/App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Point de montage de l’application introuvable.')

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
