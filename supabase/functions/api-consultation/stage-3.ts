/**
 * Stage 3 — Budget Planning
 * 
 * PUT /api/v1/projects/:id/consultation/stage/3
 * Role: owning Consultant only
 * Requires: Stage 2 COMPLETED
 * 
 * UPSERT into budget_profiles (1:1 with project).
 * Budget tier LOCKS once set — subsequent calls can update other fields but
 * cannot change budget_tier (Part 4 Stage 3: "Locks the price band for the session").
 * 
 * Stage 3 is COMPLETED when budget_tier is set.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { success, error } from '../_shared/response.ts';
import { AuthContext } from '../_shared/middleware/rbac.ts';
import {
  requireProjectOwnership,
  requirePreviousStageComplete,
  markStageStatus,
} from './sequencing.ts';

interface Stage3Body {
  budget_tier: string; // STANDARD | PREMIUM | LUXURY
  priority_spaces?: string[];
  interest_in_upgrades?: boolean;
}

export async function handleStage3(
  admin: SupabaseClient,
  projectId: string,
  auth: AuthContext,
  body: Stage3Body
): Promise<Response> {
  // Gate 4: ownership check
  const ownership = await requireProjectOwnership(admin, projectId, auth.userId);
  if ('error' in ownership) return ownership.error;

  // Sequencing: Stage 2 must be complete
  const seqBlock = await requirePreviousStageComplete(admin, projectId, 3);
  if (seqBlock) return seqBlock;

  // Validate budget_tier
  if (!body.budget_tier) {
    return error('VALIDATION_ERROR', 'budget_tier is required', 422, 'budget_tier');
  }
  const validTiers = ['STANDARD', 'PREMIUM', 'LUXURY'];
  if (!validTiers.includes(body.budget_tier)) {
    return error('VALIDATION_ERROR', `budget_tier must be one of: ${validTiers.join(', ')}`, 422, 'budget_tier');
  }

  // Check existing profile for budget tier lock
  const { data: existing } = await admin
    .from('budget_profiles')
    .select('profile_id, budget_tier')
    .eq('project_id', projectId)
    .single();

  // BUDGET TIER LOCK: once set, cannot be changed
  if (existing && existing.budget_tier && body.budget_tier !== existing.budget_tier) {
    return error(
      'BUDGET_TIER_LOCKED',
      `Budget tier cannot be changed once set. Current tier: ${existing.budget_tier} (displayed as ${getTierDisplayLabel(existing.budget_tier)})`,
      422,
      'budget_tier'
    );
  }

  const payload = {
    project_id: projectId,
    budget_tier: body.budget_tier,
    priority_spaces: body.priority_spaces ?? null,
    interest_in_upgrades: body.interest_in_upgrades ?? false,
    updated_at: new Date().toISOString(),
  };

  let resultData;

  if (existing) {
    const { data, error: updateError } = await admin
      .from('budget_profiles')
      .update(payload)
      .eq('project_id', projectId)
      .select()
      .single();

    if (updateError) {
      console.error('Stage 3 update failed:', updateError);
      return error('DB_ERROR', 'Failed to save budget profile', 500);
    }
    resultData = data;
  } else {
    const { data, error: insertError } = await admin
      .from('budget_profiles')
      .insert(payload)
      .select()
      .single();

    if (insertError) {
      console.error('Stage 3 insert failed:', insertError);
      return error('DB_ERROR', 'Failed to save budget profile', 500);
    }
    resultData = data;
  }

  // Mark Stage 3 as COMPLETED (budget_tier is now set)
  await markStageStatus(admin, projectId, 3, 'COMPLETED', auth.userId);

  return success({
    stage: 3,
    status: 'COMPLETED',
    budget_profile: resultData,
  });
}

/**
 * Display label mapping (Part 6: "UI displays Elegant/Premium/Luxury")
 * Enum values are unchanged — this is display-only.
 */
function getTierDisplayLabel(tier: string): string {
  const labels: Record<string, string> = {
    STANDARD: 'Elegant',
    PREMIUM: 'Premium',
    LUXURY: 'Luxury',
  };
  return labels[tier] || tier;
}
