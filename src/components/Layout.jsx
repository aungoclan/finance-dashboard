import { Outlet, useNavigate } from 'react-router-dom'
import Sidebar from './Sidebar'
import { supabase } from '../lib/supabase'
import { APP_ROUTES } from '../lib/routes'

export default function Layout() {
  const navigate = useNavigate()

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
      <Sidebar onLogout={handleLogout} />

      <main className="app-main" aria-label="Financial dashboard content">
        <div className="app-content">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
