import { NavLink } from 'react-router-dom'
import { NAV_SECTIONS } from '../lib/routes'

export default function Sidebar({ onLogout, isMobileOpen = false, onCloseMobile }) {
  const sidebarClassName = isMobileOpen ? 'app-sidebar app-sidebar-open' : 'app-sidebar'

  function handleNavClick() {
    if (typeof onCloseMobile === 'function') {
      onCloseMobile()
    }
  }

  function handleLogoutClick() {
    if (typeof onCloseMobile === 'function') {
      onCloseMobile()
    }

    onLogout()
  }

  return (
    <aside className={sidebarClassName} aria-label="Financial dashboard navigation">
      <div>
        <div className="sidebar-mobile-header">
          <div className="sidebar-mobile-title">Menu</div>

          <button
            type="button"
            className="sidebar-mobile-close"
            aria-label="Close navigation menu"
            onClick={onCloseMobile}
          >
            ×
          </button>
        </div>

        <div className="sidebar-brand">
          <div className="sidebar-logo-mark" aria-hidden="true">
            $
          </div>

          <div>
            <div className="sidebar-logo-title">Money Center</div>
            <div className="sidebar-logo-subtitle">Financial Dashboard V2</div>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title} className="sidebar-section">
              <div className="sidebar-section-title">{section.title}</div>

              <div className="sidebar-section-links">
                {section.items.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === '/'}
                    className={({ isActive }) =>
                      isActive ? 'sidebar-link sidebar-link-active' : 'sidebar-link'
                    }
                    title={item.description}
                    onClick={handleNavClick}
                  >
                    <span className="sidebar-link-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="sidebar-link-text">{item.name}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </div>

      <div className="sidebar-footer">
        <div
          className="sidebar-footer-note"
          style={{
            background: 'var(--bg-card-soft, rgba(241, 245, 249, 0.9))',
            color: 'var(--text-muted, #64748b)',
            border: '1px solid var(--border-main, rgba(148, 163, 184, 0.28))',
            borderRadius: '14px',
            padding: '12px 14px',
            lineHeight: 1.45,
            boxShadow: 'none'
          }}
        >
          Local-first build
          <br />
          Production readiness mode
        </div>

        <button type="button" className="sidebar-logout-button" onClick={handleLogoutClick}>
          Logout
        </button>
      </div>
    </aside>
  )
}
