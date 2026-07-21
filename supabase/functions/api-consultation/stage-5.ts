/**
 * Stage 5 — Template Selection + Sample Verification
 * 
 * Two sub-endpoints:
 * POST /api/v1/projects/:id/spaces/:space_id/select-template
 *   - Locks selected_template_id on the space
 *   - Guard: template must be PUBLISHED with active GLB (GLB Asset Readiness Gate)
 *   - Guard: template must be compatible with this space_type
 * 
 * POST /api/v1/projects/:id/spaces/:space_id/verify-samples
 *   - Sets sample_verified = TRUE + sample_verified_at
 *   - Guard: template must be selected first (selected_template_id not null)
 * 
 * Per Part 4: Engine does not run yet at Stage 5. That's Stage 7.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { success, error } from '../_shared/response.ts';
import { AuthContext } from '../_shared/middleware/rbac.ts';
import { requireProjectOwnership } from './sequencing.ts';

/**
 * Handle template selection for a space.
 * Guards: ownership, template PUBLISHED, GLB exists, space_type compatible.
 */
export async function handleSelectTemplate(
  admin: SupabaseClient,
  projectId: string,
  spaceId: string,
  auth: AuthContext,
  body: { template_id: string }
): Promise<Response> {
  // Ownership check
  const ownership = await requireProjectOwnership(admin, projectId, auth.userId);
  if ('error' in ownership) return ownership.error;

  // Validate template_id provided
  if (!body.template_id) {
    return error('VALIDATION_ERROR', 'template_id is required', 422, 'template_id');
  }

  // Verify space belongs to this project
  const { data: space } = await admin
    .from('application_spaces')
    .select('space_id, space_type, selected_template_id')
    .eq('space_id', spaceId)
    .eq('project_id', projectId)
    .single();

  if (!space) {
    return error('SPACE_NOT_FOUND', 'Space not found in this project', 404);
  }

  // Get the template
  const { data: template } = await admin
    .from('design_templates')
    .select('template_id, template_name, status, compatible_spaces, collection')
    .eq('template_id', body.template_id)
    .single();

  if (!template) {
    return error('TEMPLATE_NOT_FOUND', 'Template not found', 404);
  }

  // Guard: template must be PUBLISHED
  if (template.status !== 'PUBLISHED') {
    return error('TEMPLATE_NOT_PUBLISHED',
      `Template must be PUBLISHED to select (current: ${template.status})`, 422);
  }

  // Guard: GLB Asset Readiness Gate — template must have active GLB
  const { count: glbCount } = await admin
    .from('digital_assets')
    .select('*', { count: 'exact', head: true })
    .eq('template_id', body.template_id)
    .eq('asset_type', 'GLB')
    .eq('is_active', true);

  if (!glbCount || glbCount === 0) {
    return error('GLB_NOT_READY',
      'Template does not have an active GLB asset (GLB Asset Readiness Gate)', 422);
  }

  // Guard: template must be compatible with this space_type
  if (template.compatible_spaces && template.compatible_spaces.length > 0) {
    if (!template.compatible_spaces.includes(space.space_type)) {
      return error('TEMPLATE_SPACE_INCOMPATIBLE',
        `Template is not compatible with space type '${space.space_type}'. ` +
        `Compatible: ${template.compatible_spaces.join(', ')}`, 422);
    }
  }

  // Lock the template on the space
  const { error: updateErr } = await admin
    .from('application_spaces')
    .update({
      selected_template_id: body.template_id,
      updated_at: new Date().toISOString(),
    })
    .eq('space_id', spaceId);

  if (updateErr) {
    return error('DB_ERROR', 'Failed to select template', 500);
  }

  return success({
    space_id: spaceId,
    selected_template_id: body.template_id,
    template_name: template.template_name,
    message: 'Template selected successfully',
  });
}

/**
 * Handle sample verification for a space.
 * Guard: template must be selected first.
 */
export async function handleVerifySamples(
  admin: SupabaseClient,
  projectId: string,
  spaceId: string,
  auth: AuthContext
): Promise<Response> {
  // Ownership check
  const ownership = await requireProjectOwnership(admin, projectId, auth.userId);
  if ('error' in ownership) return ownership.error;

  // Verify space belongs to this project and has a template selected
  const { data: space } = await admin
    .from('application_spaces')
    .select('space_id, selected_template_id, sample_verified')
    .eq('space_id', spaceId)
    .eq('project_id', projectId)
    .single();

  if (!space) {
    return error('SPACE_NOT_FOUND', 'Space not found in this project', 404);
  }

  // Guard: template must be selected before samples can be verified
  if (!space.selected_template_id) {
    return error('TEMPLATE_NOT_SELECTED',
      'A template must be selected before verifying samples', 422);
  }

  // Idempotent: if already verified, return success
  if (space.sample_verified) {
    return success({
      space_id: spaceId,
      sample_verified: true,
      message: 'Samples already verified',
      already_verified: true,
    });
  }

  // Set sample_verified
  const verifiedAt = new Date().toISOString();
  const { error: updateErr } = await admin
    .from('application_spaces')
    .update({
      sample_verified: true,
      sample_verified_at: verifiedAt,
      updated_at: verifiedAt,
    })
    .eq('space_id', spaceId);

  if (updateErr) {
    return error('DB_ERROR', 'Failed to verify samples', 500);
  }

  return success({
    space_id: spaceId,
    sample_verified: true,
    sample_verified_at: verifiedAt,
    message: 'Physical samples verified successfully',
  });
}
