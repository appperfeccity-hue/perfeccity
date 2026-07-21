import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { callApi } from '@/lib/supabase';

export function DashboardPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    setLoading(true);
    const res = await callApi('/api-leads');
    if (res.data && Array.isArray(res.data)) {
      setProjects(res.data.slice(0, 5));
    }
    setLoading(false);
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginBottom: 24 }}>Dashboard</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
        <div className="card">
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--accent-bright)' }}>
            {projects.length}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Active Projects</div>
        </div>
        <div className="card">
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--success)' }}>7</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Consultation Stages</div>
        </div>
        <div className="card">
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--accent)' }}>18</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>API Endpoints</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Recent Projects</div>
        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
        ) : projects.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No projects yet. Create a lead to get started.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Status</th>
                <th>City</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p: any) => (
                <tr key={p.lead_id || p.project_id}>
                  <td>{p.customer_name}</td>
                  <td><span className={`badge badge-${p.status?.toLowerCase()}`}>{p.status}</span></td>
                  <td>{p.city || '-'}</td>
                  <td>
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => navigate(`/projects/${p.project_id || p.lead_id}/consultation`)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
