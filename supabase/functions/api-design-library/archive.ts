/**
 * Archive — Sprint 3 T7
 *
 * POST /api/v1/design-library/:id/archive
 * Role: ADMIN only
 * Transition: PUBLISHED → ARCHIVED (one-way)
 * Sets archived_at
 *
 * Effect: Removed from Consultant design library; existing projects unaffected.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { success, error } from '../_shared/response.ts';
import { AuthContext } from '../_shared/middleware/rbac.ts';

export async function handleArchive(
  admin: SupabaseClient,
  templateId: string,
  auth: AuthContext
): Promise<Response> {
  // Fetch template
  const { data: template } = await admin
    .from('design_templates')
    .select('template_id, status, template_name')
    .eq('template_id', templateId)
    .single();

  if (!template) return error('TEMPLATE_NOT_FOUND', 'Template not found', 404);

  // Only PUBLISHED can be archived
  if (template.status !== 'PUBLISHED') {
    return error('INVALID_STATUS_TRANSITION',
      `Cannot archive: template is '${template.status}', must be PUBLISHED`, 422);
  }

  const now = new Date().toISOString();

  // Transition: PUBLISHED → ARCHIVED (one-way)
  const { error: updateErr } = await admin
    .from('design_templates')
    .update({
      status: 'ARCHIVED',
      archived_at: now,
      updated_at: now,
    })
    .eq('template_id', templateId);

  if (updateErr) {
    return error('DB_ERROR', 'Failed to archive: ' + updateErr.message, 500);
  }

  return success({
    template_id: templateId,
    status: 'ARCHIVED',
    archived_at: now,
    message: 'Template archived. Existing projects are unaffected.',
  });
}
