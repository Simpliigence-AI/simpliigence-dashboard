import './lib/storageQuotaGuard'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { reloadOnceForStaleChunk } from './lib/staleChunk'

// A deploy replaced the hashed chunk this tab still points at (AppDesk #2540).
// Vite fires this when a lazy import or its preload fails; reload once to
// pick up the new build instead of showing an error screen.
window.addEventListener('vite:preloadError', (event) => {
  if (reloadOnceForStaleChunk()) event.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
