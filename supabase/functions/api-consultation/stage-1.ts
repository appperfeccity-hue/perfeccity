/**
 * Stage 1 — Customer Profile (Welcome & Registration)
 * 
 * PUT /api/v1/projects/:id/consultation/stage/1
 * Role: owning Consultant only
 * 
 * Saves/updates customer profile information on the project.
 * On first submission: triggers stage initialization (T1) and
 * PROJECT_CREATED → CONFIGURING transition.
 * 
 * Fields (all update projects table directly):
 * - customer_name (required)
 * - project_address
 * - city
 * - project_type (RESIDENTIAL/COMMERCIAL)
 * 
 * Stage 1 is COMPLETED when customer_name is non-null.
 * (Minimal requirement — address/city/type are optional refinements.)
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { success, error } from '../_shared/response.ts';
import { AuthContext } from '../_shared/middleware/rbac.ts';
import {
  ensureStagesInitialized,
  requireProjectOwnership,
  markStageStatus,
} from './sequencing.ts';

interface Stage1Body {
  customer_name: string;
  project_address?: string;
  city?: string;
  project_type?: string;
}

export async function handleStage1(
  admin: SupabaseClient,
  projectId: string,
  auth: AuthContext,
  body: Stage1Body
): Promise<Response> {
  // Gate 4: ownership check
  const ownership = await requireProjectOwnership(admin, projectId, auth.userId);
  if ('error' in ownership) return ownership.error;

  // Validate required fields
  if (!body.customer_name || body.customer_name.trim() === '') {
    return error('VALIDATION_ERROR', 'customer_name is required', 422, 'customer_name');
  }

  // Validate project_type if provided
  if (body.project_type && !['RESIDENTIAL', 'COMMERCIAL'].includes(body.project_type)) {
    return error('VALIDATION_ERROR', 'project_type must be RESIDENTIAL or COMMERCIAL', 422, 'project_type');
  }

  // T1: Initialize stages + transition PROJECT_CREATED → CONFIGURING
  const init = await ensureStagesInitialized(admin, projectId, auth.userId);
  if (init.error) return init.error;

  // Update project fields (customer profile refinement)
  const updatePayload: Record<string, unknown> = {
    customer_name: body.customer_name.trim(),
    updated_at: new Date().toISOString(),
  };
  if (body.project_address !== undefined) updatePayload.project_address = body.project_address;
  if (body.city !== undefined) updatePayload.city = body.city;
  if (body.project_type !== undefined) updatePayload.project_type = body.project_type;

  const { error: updateError } = await admin
    .from('projects')
    .update(updatePayload)
    .eq('project_id', projectId);

  if (updateError) {
    console.error('Stage 1 project update failed:', updateError);
    return error('DB_ERROR', 'Failed to save customer profile', 500);
  }

  // Mark Stage 1 as COMPLETED (customer_name is non-null = complete)
  await markStageStatus(admin, projectId, 1, 'COMPLETED', auth.userId);

  // Return the updated project data
  const { data: updatedProject } = await admin
    .from('projects')
    .select('project_id, customer_name, project_address, city, project_type, status')
    .eq('project_id', projectId)
    .single();

  return success({
    stage: 1,
    status: 'COMPLETED',
    project: updatedProject,
  });
}
