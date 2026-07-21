import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { callApi } from '@/lib/supabase';

const STAGES = [
  { num: 1, name: 'Customer Profile' },
  { num: 2, name: 'Lifestyle Assessment' },
  { num: 3, name: 'Budget Planning' },
  { num: 4, name: 'Space Selection' },
  { num: 5, name: 'Template Selection' },
  { num: 6, name: 'Site Assessment' },
  { num: 7, name: 'Measurements' },
];

export function ConsultationPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [activeStage, setActiveStage] = useState(1);
  const [progress, setProgress] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => { loadProgress(); }, [projectId]);

  async function loadProgress() {
    if (!projectId) return;
    const res = await callApi(
      `/api-consultation/api/v1/projects/${projectId}/consultation/progress`
    );
    if (res.data && (res.data as any).stages) {
      setProgress((res.data as any).stages);
    }
  }

  function getStageStatus(num: number) {
    const s = progress.find((p: any) => p.stage_number === num);
    return s?.status || 'PENDING';
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Consultation</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
        Project: {projectId?.slice(0, 8)}...
      </p>

      {/* Stage Progress Bar */}
      <div className="stage-bar">
        {STAGES.map(s => (
          <div
            key={s.num}
            className={`stage-dot ${
              getStageStatus(s.num) === 'COMPLETED' ? 'completed' :
              s.num === activeStage ? 'active' : ''
            }`}
            onClick={() => setActiveStage(s.num)}
            style={{ cursor: 'pointer' }}
            title={`Stage ${s.num}: ${s.name}`}
          />
        ))}
      </div>

      {/* Stage Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {STAGES.map(s => (
          <button
            key={s.num}
            className={`btn btn-sm ${s.num === activeStage ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveStage(s.num)}
          >
            {s.num}. {s.name}
            {getStageStatus(s.num) === 'COMPLETED' && ' \u2713'}
          </button>
        ))}
      </div>

      {message && (
        <div style={{ padding: 12, background: '#e8f5e9', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          {message}
        </div>
      )}

      {/* Stage Forms */}
      <div className="card">
        <StageForm
          projectId={projectId!}
          stage={activeStage}
          onSuccess={(msg) => { setMessage(msg); loadProgress(); }}
          setLoading={setLoading}
        />
      </div>
    </div>
  );
}

function StageForm({ projectId, stage, onSuccess, setLoading }: {
  projectId: string; stage: number;
  onSuccess: (msg: string) => void; setLoading: (v: boolean) => void;
}) {
  const [form, setForm] = useState<Record<string, any>>({});

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  async function submitStage() {
    setLoading(true);
    const res = await callApi(
      `/api-consultation/api/v1/projects/${projectId}/consultation/stage/${stage}`,
      { method: 'PUT', body: form }
    );
    setLoading(false);
    if (res.errors?.length) {
      onSuccess(`Error: ${res.errors[0].message}`);
    } else {
      onSuccess(`Stage ${stage} saved successfully`);
    }
  }

  switch (stage) {
    case 1:
      return (
        <div>
          <div className="card-header">Stage 1: Customer Profile</div>
          <div className="form-group">
            <label className="form-label">Customer Name *</label>
            <input className="form-input" value={form.customer_name || ''} onChange={e => set('customer_name', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Project Address</label>
            <input className="form-input" value={form.project_address || ''} onChange={e => set('project_address', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">City</label>
            <input className="form-input" value={form.city || ''} onChange={e => set('city', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Project Type</label>
            <select className="form-input" value={form.project_type || ''} onChange={e => set('project_type', e.target.value)}>
              <option value="">Select...</option>
              <option value="RESIDENTIAL">Residential</option>
              <option value="COMMERCIAL">Commercial</option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={submitStage}>Save & Complete Stage 1</button>
        </div>
      );

    case 2:
      return (
        <div>
          <div className="card-header">Stage 2: Lifestyle Assessment</div>
          <div className="form-group">
            <label className="form-label">Family Members</label>
            <input type="number" className="form-input" value={form.family_member_count || ''} onChange={e => set('family_member_count', parseInt(e.target.value))} />
          </div>
          <div className="form-group">
            <label className="form-label">Has Children</label>
            <select className="form-input" value={form.has_children ?? ''} onChange={e => set('has_children', e.target.value === 'true')}>
              <option value="">Select...</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Work From Home</label>
            <select className="form-input" value={form.work_from_home ?? ''} onChange={e => set('work_from_home', e.target.value === 'true')}>
              <option value="">Select...</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={submitStage}>Save & Complete Stage 2</button>
        </div>
      );

    case 3:
      return (
        <div>
          <div className="card-header">Stage 3: Budget Planning</div>
          <div className="form-group">
            <label className="form-label">Budget Tier *</label>
            <select className="form-input" value={form.budget_tier || ''} onChange={e => set('budget_tier', e.target.value)}>
              <option value="">Select...</option>
              <option value="STANDARD">Elegant (Standard)</option>
              <option value="PREMIUM">Premium</option>
              <option value="LUXURY">Luxury</option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={submitStage}>Save & Complete Stage 3</button>
        </div>
      );

    case 4:
      return (
        <div>
          <div className="card-header">Stage 4: Space Selection</div>
          <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>Select the spaces to be designed (1 primary + up to 4 secondary).</p>
          <div className="form-group">
            <label className="form-label">Primary Space Type *</label>
            <select className="form-input" value={form.primary_space || ''} onChange={e => set('primary_space', e.target.value)}>
              <option value="">Select...</option>
              <option value="TV_UNIT_WALL">TV Unit Wall</option>
              <option value="LIVING_ROOM_FEATURE_WALL">Living Room Feature Wall</option>
              <option value="BED_BACK_WALL">Bed Back Wall</option>
              <option value="HOME_ENTRANCE">Home Entrance</option>
              <option value="STUDY_WALL">Study Wall</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Wall Shape</label>
            <select className="form-input" value={form.wall_shape || ''} onChange={e => set('wall_shape', e.target.value)}>
              <option value="STRAIGHT">Straight</option>
              <option value="L_SHAPE">L-Shape</option>
              <option value="C_SHAPE">C-Shape</option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={() => {
            const body = { spaces: [{ space_type: form.primary_space, wall_shape: form.wall_shape || 'STRAIGHT', is_primary_wall: true }] };
            setForm(body);
            submitStage();
          }}>Save & Complete Stage 4</button>
        </div>
      );

    case 5:
      return (
        <div>
          <div className="card-header">Stage 5: Template Selection</div>
          <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
            Use the Recommendation Engine to find the best template, then select it for each space.
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            POST /spaces/:space_id/recommendation &rarr; POST /spaces/:space_id/select-template &rarr; POST /spaces/:space_id/verify-samples
          </p>
          <p style={{ marginTop: 16, padding: 12, background: 'var(--surface-dim)', borderRadius: 8, fontSize: 13 }}>
            Stage 5 uses dedicated endpoints per space (not PUT /stage/5). Select a template, then verify physical samples.
          </p>
        </div>
      );

    case 6:
      return (
        <div>
          <div className="card-header">Stage 6: Site Assessment</div>
          <div className="form-group">
            <label className="form-label">Wall Type *</label>
            <select className="form-input" value={form.wall_type || ''} onChange={e => set('wall_type', e.target.value)}>
              <option value="">Select...</option>
              <option value="BRICK">Brick</option>
              <option value="DRYWALL">Drywall</option>
              <option value="RCC">RCC (Concrete)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Moisture Level *</label>
            <select className="form-input" value={form.moisture_level || ''} onChange={e => set('moisture_level', e.target.value)}>
              <option value="">Select...</option>
              <option value="DRY">Dry</option>
              <option value="AMBIENT">Ambient</option>
              <option value="HIGH">High</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Has Electrical Points</label>
            <select className="form-input" value={form.has_electrical ?? ''} onChange={e => set('has_electrical', e.target.value === 'true')}>
              <option value="">Select...</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={submitStage}>Save & Complete Stage 6</button>
        </div>
      );

    case 7:
      return (
        <div>
          <div className="card-header">Stage 7: Measurements</div>
          <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
            Enter wall measurements. The Configuration Engine runs automatically after submission.
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: 12, background: 'var(--surface-dim)', borderRadius: 8 }}>
            POST /spaces/:space_id/measurements triggers R1-R8 engine + persist_configuration RPC.
          </p>
        </div>
      );

    default:
      return <p>Unknown stage</p>;
  }
}
