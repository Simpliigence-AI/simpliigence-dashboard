import './lib/storageQuotaGuard'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { reloadForNewBuild } from './lib/lazyWithReload'

// A page's JS or CSS file is missing because a new version was deployed while this tab was open.
window.addEventListener('vite:preloadError', (event) => {
  if (reloadForNewBuild()) event.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
