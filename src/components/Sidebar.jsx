import { NavLink } from 'react-router-dom'
import { NAV_SECTIONS } from '../lib/routes'

export default function Sidebar({ onLogout }) {
  return (
    <aside className="app-sidebar" aria-label="Financial dashboard navigation">
      <div>
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
        <div className="sidebar-footer-note">
          Local-first build
          <br />
          Production readiness mode
        </div>

        <button type="button" className="sidebar-logout-button" onClick={onLogout}>
          Logout
        </button>
      </div>
    </aside>
  )
}
