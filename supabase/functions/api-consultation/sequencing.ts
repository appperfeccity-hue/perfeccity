/**
 * Consultation Stage Sequencing Utilities — Sprint 2 T8
 * 
 * Shared guards used by all stage handlers (T2–T5):
 * - ensureStagesInitialized: creates 7 stage rows + PROJECT_CREATED→CONFIGURING
 * - requirePreviousStageComplete: blocks stage N if stage N-1 isn't COMPLETED
 * - markStageComplete: transitions a stage to COMPLETED with timestamp
 * - requireProjectOwnership: verifies consultant_id = auth.uid()
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { error } from '../_shared/response.ts';

/**
 * Ensures consultation stages are initialized for a project.
 * Called on first Stage 1 submission — idempotent (skips if already done).
 * 
 * Side effects on first call:
 * 1. Creates 7 consultation_stages rows (stages 1–7, all PENDING)
 * 2. Transitions project status: PROJECT_CREATED → CONFIGURING
 * 3. Writes project_state_history row for audit
 * 
 * Idempotent: if stages already exist, does nothing (returns silently).
 */
export async function ensureStagesInitialized(
  admin: SupabaseClient,
  projectId: string,
  consultantId: string
): Promise<{ error?: Response }> {
  // Check if stages already exist (idempotent guard)
  const { count } = await admin
    .from('consultation_stages')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId);

  if (count && count > 0) {
    // Already initialized — nothing to do
    return {};
  }

  // Create 7 stage rows (one per stage, all PENDING)
  const stageRows = Array.from({ length: 7 }, (_, i) => ({
    project_id: projectId,
    stage_number: i + 1,
    status: 'PENDING',
  }));

  const { error: insertError } = await admin
    .from('consultation_stages')
    .insert(stageRows);

  if (insertError) {
    // Could be a race condition (concurrent first-access) — check if they exist now
    const { count: recheck } = await admin
      .from('consultation_stages')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId);

    if (recheck && recheck > 0) {
      // Another request beat us — that's fine, stages exist
      return {};
    }

    console.error('Failed to create consultation stages:', insertError);
    return { error: error('DB_ERROR', 'Failed to initialize consultation stages', 500) };
  }

  // Transition project status: PROJECT_CREATED → CONFIGURING
  // Only transition if currently PROJECT_CREATED (idempotent — don't downgrade)
  const { data: project } = await admin
    .from('projects')
    .select('status')
    .eq('project_id', projectId)
    .single();

  if (project && project.status === 'PROJECT_CREATED') {
    await admin
      .from('projects')
      .update({ status: 'CONFIGURING', updated_at: new Date().toISOString() })
      .eq('project_id', projectId);

    // Audit trail
    await admin.from('project_state_history').insert({
      project_id: projectId,
      from_status: 'PROJECT_CREATED',
      to_status: 'CONFIGURING',
      actor_id: consultantId,
      trigger_rule: 'CONSULTATION_STARTED',
      note: 'First consultation stage accessed — project moves to CONFIGURING',
    });
  }

  return {};
}

/**
 * Stage sequencing guard: blocks stage N if stage N-1 isn't COMPLETED.
 * Stage 1 is always accessible (no previous stage required).
 * 
 * Returns a Response (error) if blocked, or null if allowed to proceed.
 */
export async function requirePreviousStageComplete(
  admin: SupabaseClient,
  projectId: string,
  targetStage: number
): Promise<Response | null> {
  if (targetStage <= 1) return null; // Stage 1 always accessible

  const { data: prevStage, error: queryError } = await admin
    .from('consultation_stages')
    .select('status')
    .eq('project_id', projectId)
    .eq('stage_number', targetStage - 1)
    .single();

  if (queryError || !prevStage) {
    // Stages don't exist yet — shouldn't happen if ensureStagesInitialized ran
    return error(
      'PREVIOUS_STAGE_INCOMPLETE',
      `Stage ${targetStage - 1} must be completed before Stage ${targetStage}. Stages may not be initialized.`,
      422
    );
  }

  if (prevStage.status !== 'COMPLETED') {
    return error(
      'PREVIOUS_STAGE_INCOMPLETE',
      `Stage ${targetStage - 1} must be completed before Stage ${targetStage}`,
      422
    );
  }

  return null; // Proceed
}

/**
 * Marks a stage as COMPLETED (or IN_PROGRESS if only partially filled).
 * Idempotent: can be called multiple times without harm.
 */
export async function markStageStatus(
  admin: SupabaseClient,
  projectId: string,
  stageNumber: number,
  status: 'IN_PROGRESS' | 'COMPLETED',
  completedBy?: string
): Promise<void> {
  const updatePayload: Record<string, unknown> = { status };
  if (status === 'COMPLETED') {
    updatePayload.completed_at = new Date().toISOString();
    if (completedBy) updatePayload.completed_by = completedBy;
  }

  await admin
    .from('consultation_stages')
    .update(updatePayload)
    .eq('project_id', projectId)
    .eq('stage_number', stageNumber);
}

/**
 * Verifies the authenticated user owns this project (consultant_id = auth.uid()).
 * Returns a 403 Response if not owned, or null if ownership confirmed.
 * 
 * This is Gate 4's implementation for Sprint 2:
 * "Consultant cannot open Stage 1 on a lead where assigned_consultant_id ≠ self"
 */
export async function requireProjectOwnership(
  admin: SupabaseClient,
  projectId: string,
  userId: string
): Promise<{ project: Record<string, unknown> } | { error: Response }> {
  const { data: project, error: queryError } = await admin
    .from('projects')
    .select('project_id, consultant_id, status, customer_name, project_address, city, project_type')
    .eq('project_id', projectId)
    .single();

  if (queryError || !project) {
    return { error: error('PROJECT_NOT_FOUND', 'No project found with the specified ID', 404) };
  }

  if (project.consultant_id !== userId) {
    return { error: error('LEAD_NOT_ASSIGNED_TO_YOU', 'You are not the assigned consultant for this project', 403) };
  }

  return { project };
}
