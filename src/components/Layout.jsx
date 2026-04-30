import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import Sidebar from './Sidebar'
import ErrorBoundary from './ErrorBoundary'
import { supabase } from '../lib/supabase'
import { APP_ROUTES } from '../lib/routes'

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)

  useEffect(() => {
    setIsMobileNavOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!isMobileNavOpen) return

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsMobileNavOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.body.classList.add('mobile-nav-lock')

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.classList.remove('mobile-nav-lock')
    }
  }, [isMobileNavOpen])

  async function handleLogout() {
    const { error } = await supabase.auth.signOut()

    if (error) {
      console.error('Logout error:', error.message)
      return
    }

    navigate(APP_ROUTES.login)
  }

  return (
    <div className="app-shell">
      <button
        type="button"
        className="mobile-nav-backdrop"
        aria-label="Close navigation"
        aria-hidden={!isMobileNavOpen}
        tabIndex={isMobileNavOpen ? 0 : -1}
        onClick={() => setIsMobileNavOpen(false)}
      />

      <Sidebar
        onLogout={handleLogout}
        isMobileOpen={isMobileNavOpen}
        onCloseMobile={() => setIsMobileNavOpen(false)}
      />

      <main className="app-main" aria-label="Financial dashboard content">
        <div className="mobile-topbar">
          <button
            type="button"
            className="mobile-menu-button"
            aria-label="Open navigation menu"
            aria-expanded={isMobileNavOpen}
            onClick={() => setIsMobileNavOpen(true)}
          >
            <span aria-hidden="true">☰</span>
          </button>

          <div className="mobile-topbar-brand">
            <div className="mobile-topbar-title">Money Center</div>
            <div className="mobile-topbar-subtitle">Financial Dashboard V2</div>
          </div>
        </div>

        <div className="app-content">
          <ErrorBoundary
            title="This page could not load"
            description="A page component crashed. The sidebar and app shell are still available so you can move to another page."
            resetKey={location.pathname}
          >
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>
    </div>
  )
}
