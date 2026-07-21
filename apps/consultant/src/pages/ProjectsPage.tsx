import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { callApi } from '@/lib/supabase';

export function ProjectsPage() {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => { loadLeads(); }, []);

  async function loadLeads() {
    setLoading(true);
    const res = await callApi('/api-leads');
    if (res.data) {
      setLeads(Array.isArray(res.data) ? res.data : []);
    }
    setLoading(false);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24 }}>Projects</h1>
      </div>

      <div className="card">
        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading projects...</p>
        ) : leads.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No projects found.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Status</th>
                <th>City</th>
                <th>Type</th>
                <th>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead: any) => (
                <tr key={lead.lead_id || lead.project_id}>
                  <td style={{ fontWeight: 500 }}>{lead.customer_name}</td>
                  <td><span className={`badge badge-${lead.status?.toLowerCase()}`}>{lead.status}</span></td>
                  <td>{lead.city || '-'}</td>
                  <td>{lead.project_type || '-'}</td>
                  <td>{lead.created_at ? new Date(lead.created_at).toLocaleDateString() : '-'}</td>
                  <td>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => navigate(`/projects/${lead.project_id || lead.lead_id}/consultation`)}
                    >
                      Consultation
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
