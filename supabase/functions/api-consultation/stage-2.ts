/**
 * Stage 2 — Lifestyle Assessment
 * 
 * PUT /api/v1/projects/:id/consultation/stage/2
 * Role: owning Consultant only
 * Requires: Stage 1 COMPLETED
 * 
 * UPSERT into lifestyle_assessments (1:1 with project).
 * Stage 2 is COMPLETED when the row exists (any fields populated).
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { success, error } from '../_shared/response.ts';
import { AuthContext } from '../_shared/middleware/rbac.ts';
import {
  requireProjectOwnership,
  requirePreviousStageComplete,
  markStageStatus,
} from './sequencing.ts';

interface Stage2Body {
  family_member_count?: number;
  has_children?: boolean;
  has_senior_citizens?: boolean;
  has_pets?: boolean;
  work_from_home?: boolean;
  storage_need?: string;
  maintenance_expectation?: string;
  preferred_style_notes?: string;
}

export async function handleStage2(
  admin: SupabaseClient,
  projectId: string,
  auth: AuthContext,
  body: Stage2Body
): Promise<Response> {
  // Gate 4: ownership check
  const ownership = await requireProjectOwnership(admin, projectId, auth.userId);
  if ('error' in ownership) return ownership.error;

  // Sequencing: Stage 1 must be complete
  const seqBlock = await requirePreviousStageComplete(admin, projectId, 2);
  if (seqBlock) return seqBlock;

  // UPSERT into lifestyle_assessments
  const { data: existing } = await admin
    .from('lifestyle_assessments')
    .select('assessment_id')
    .eq('project_id', projectId)
    .single();

  const payload = {
    project_id: projectId,
    family_member_count: body.family_member_count ?? null,
    has_children: body.has_children ?? null,
    has_senior_citizens: body.has_senior_citizens ?? null,
    has_pets: body.has_pets ?? null,
    work_from_home: body.work_from_home ?? null,
    storage_need: body.storage_need ?? null,
    maintenance_expectation: body.maintenance_expectation ?? null,
    preferred_style_notes: body.preferred_style_notes ?? null,
    updated_at: new Date().toISOString(),
  };

  let resultData;

  if (existing) {
    // UPDATE existing row
    const { data, error: updateError } = await admin
      .from('lifestyle_assessments')
      .update(payload)
      .eq('project_id', projectId)
      .select()
      .single();

    if (updateError) {
      console.error('Stage 2 update failed:', updateError);
      return error('DB_ERROR', 'Failed to save lifestyle assessment', 500);
    }
    resultData = data;
  } else {
    // INSERT new row
    const { data, error: insertError } = await admin
      .from('lifestyle_assessments')
      .insert(payload)
      .select()
      .single();

    if (insertError) {
      console.error('Stage 2 insert failed:', insertError);
      return error('DB_ERROR', 'Failed to save lifestyle assessment', 500);
    }
    resultData = data;
  }

  // Mark Stage 2 as COMPLETED
  await markStageStatus(admin, projectId, 2, 'COMPLETED', auth.userId);

  return success({
    stage: 2,
    status: 'COMPLETED',
    lifestyle_assessment: resultData,
  });
}
