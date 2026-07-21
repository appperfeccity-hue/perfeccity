import { NavLink, useNavigate } from 'react-router-dom';
import { logout } from '@/lib/auth';
import { useAuth } from '@/hooks/useAuth';

export function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div style={{ marginBottom: 32 }}>
          <h2 className="logo-text" style={{ fontSize: 18, fontWeight: 700 }}>PERFECCITY</h2>
          <p className="nav-text" style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>Consultant Portal</p>
        </div>

        <nav>
          <div className="nav-section"><span className="nav-text">Main</span></div>
          <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span>&#9632;</span> <span className="nav-text">Dashboard</span>
          </NavLink>
          <NavLink to="/projects" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span>&#9634;</span> <span className="nav-text">Projects</span>
          </NavLink>

          <div className="nav-section" style={{ marginTop: 24 }}><span className="nav-text">Account</span></div>
          <div className="nav-item" style={{ fontSize: 12, opacity: 0.7 }}>
            <span className="nav-text">{user?.email}</span>
          </div>
          <button onClick={handleLogout} className="nav-item" style={{ border: 'none', background: 'none', cursor: 'pointer', width: '100%', textAlign: 'left' }}>
            <span>&#8594;</span> <span className="nav-text">Sign Out</span>
          </button>
        </nav>
      </aside>

      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
