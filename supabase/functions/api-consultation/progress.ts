/**
 * Consultation Progress — Sprint 2 T6
 * 
 * GET /api/v1/projects/:id/consultation/progress
 * Returns stage-by-stage completion state (7 stages).
 * 
 * Stages 5-7 always return PENDING (Sprint 4 scope).
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { success, error } from '../_shared/response.ts';
import { AuthContext } from '../_shared/middleware/rbac.ts';
import { requireProjectOwnership } from './sequencing.ts';

export async function handleProgress(
  admin: SupabaseClient,
  projectId: string,
  auth: AuthContext
): Promise<Response> {
  // Gate 4: ownership check
  const ownership = await requireProjectOwnership(admin, projectId, auth.userId);
  if ('error' in ownership) return ownership.error;

  // Get all consultation stages for this project
  const { data: stages, error: queryError } = await admin
    .from('consultation_stages')
    .select('stage_number, status, completed_at, completed_by')
    .eq('project_id', projectId)
    .order('stage_number', { ascending: true });

  if (queryError) {
    console.error('Progress query failed:', queryError);
    return error('DB_ERROR', 'Failed to retrieve progress', 500);
  }

  // If no stages exist yet (project hasn't been started), return all PENDING
  if (!stages || stages.length === 0) {
    const defaultStages = Array.from({ length: 7 }, (_, i) => ({
      stage_number: i + 1,
      status: 'PENDING',
      completed_at: null,
      completed_by: null,
    }));
    return success({ stages: defaultStages });
  }

  return success({ stages });
}
