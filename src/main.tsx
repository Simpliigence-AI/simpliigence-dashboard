import './lib/storageQuotaGuard'
import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { reloadForNewBuild } from './lib/lazyWithReload'

// A page's JS or CSS file is missing because a new version was deployed while this tab was open.
window.addEventListener('vite:preloadError', (event) => {
  if (reloadForNewBuild()) event.preventDefault()
})

// The client portal (/portal) is a separate app: no staff sign-in, no internal stores.
const base = import.meta.env.BASE_URL.replace(/\/$/, '')
const isPortal = window.location.pathname === `${base}/portal` || window.location.pathname.startsWith(`${base}/portal/`)
const PortalApp = lazy(() => import('./portal/PortalApp'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPortal ? <Suspense fallback={null}><PortalApp /></Suspense> : <App />}
  </StrictMode>,
)
