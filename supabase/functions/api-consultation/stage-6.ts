/**
 * Stage 6 — Site Assessment
 * 
 * PUT /api/v1/projects/:id/consultation/stage/6
 *   - Saves site assessment data (wall_type, moisture_level, etc.)
 *   - Guard: must have ≥1 site photo uploaded (Part 4 WF-3)
 *   - Gates Stage 7: Stage 6 must be COMPLETED before measurements
 * 
 * Per Part 4: "Completed only when form saved AND photo uploaded"
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { success, error } from '../_shared/response.ts';
import { AuthContext } from '../_shared/middleware/rbac.ts';
import { requireProjectOwnership, markStageStatus } from './sequencing.ts';

interface SiteAssessmentBody {
  wall_type?: string;
  moisture_level?: string;
  has_electrical?: boolean;
  lift_available?: boolean;
  parking_available?: boolean;
  site_notes?: string;
}

export async function handleStage6(
  admin: SupabaseClient,
  projectId: string,
  auth: AuthContext,
  body: SiteAssessmentBody
): Promise<Response> {
  // Ownership check
  const ownership = await requireProjectOwnership(admin, projectId, auth.userId);
  if ('error' in ownership) return ownership.error;

  // Guard: at least one site photo must exist (not soft-deleted)
  const { count: photoCount } = await admin
    .from('site_photographs')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('is_deleted', false);

  if (!photoCount || photoCount === 0) {
    return error('SITE_PHOTO_REQUIRED',
      'At least one site photo must be uploaded before completing the site assessment', 422);
  }

  // Validate required fields
  if (!body.wall_type) {
    return error('VALIDATION_ERROR', 'wall_type is required', 422, 'wall_type');
  }
  if (!body.moisture_level) {
    return error('VALIDATION_ERROR', 'moisture_level is required', 422, 'moisture_level');
  }

  // Upsert site assessment
  const { data: assessment, error: upsertErr } = await admin
    .from('site_assessments')
    .upsert({
      project_id: projectId,
      wall_type: body.wall_type,
      moisture_level: body.moisture_level,
      has_electrical: body.has_electrical ?? null,
      lift_available: body.lift_available ?? null,
      parking_available: body.parking_available ?? null,
      site_notes: body.site_notes ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'project_id' })
    .select()
    .single();

  if (upsertErr) {
    return error('DB_ERROR', 'Failed to save site assessment: ' + upsertErr.message, 500);
  }

  // Mark Stage 6 as COMPLETED
  await markStageStatus(admin, projectId, 6, 'COMPLETED', auth.userId);

  return success({
    project_id: projectId,
    assessment,
    stage: 6,
    status: 'COMPLETED',
    message: 'Site assessment saved. Stage 7 (measurements) is now accessible.',
  });
}
