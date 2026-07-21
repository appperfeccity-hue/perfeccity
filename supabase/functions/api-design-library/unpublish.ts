/**
 * Emergency Unpublish — Sprint 3 T7
 *
 * POST /api/v1/design-library/:id/unpublish
 * Role: ADMIN only
 * Transition: PUBLISHED → DRAFT
 * Body: { reason } (required — emergency action, must be logged)
 *
 * Not standard flow — used for error-correction only.
 * The same Admin who published CAN unpublish (explicitly allowed per spec).
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { success, error } from '../_shared/response.ts';
import { AuthContext } from '../_shared/middleware/rbac.ts';

export async function handleUnpublish(
  admin: SupabaseClient,
  templateId: string,
  auth: AuthContext,
  body: { reason?: string }
): Promise<Response> {
  // Reason is required (emergency action)
  if (!body.reason || body.reason.trim() === '') {
    return error('VALIDATION_ERROR', 'reason is required for emergency unpublish', 422, 'reason');
  }

  // Fetch template
  const { data: template } = await admin
    .from('design_templates')
    .select('template_id, status, template_name')
    .eq('template_id', templateId)
    .single();

  if (!template) return error('TEMPLATE_NOT_FOUND', 'Template not found', 404);

  // Only PUBLISHED can be unpublished
  if (template.status !== 'PUBLISHED') {
    return error('INVALID_STATUS_TRANSITION',
      `Cannot unpublish: template is '${template.status}', must be PUBLISHED`, 422);
  }

  const now = new Date().toISOString();

  // Transition: PUBLISHED → DRAFT
  const { error: updateErr } = await admin
    .from('design_templates')
    .update({
      status: 'DRAFT',
      published_at: null,
      updated_at: now,
    })
    .eq('template_id', templateId);

  if (updateErr) {
    return error('DB_ERROR', 'Failed to unpublish: ' + updateErr.message, 500);
  }

  // Log the emergency action (audit trail via notifications or dedicated log)
  await admin.from('notifications').insert({
    recipient_role: 'ADMIN',
    notification_type: 'TEMPLATE_CHANGES_REQUESTED',
    title: `Emergency unpublish: ${template.template_name}`,
    body: `Template "${template.template_name}" was emergency-unpublished. Reason: ${body.reason}`,
    metadata: { template_id: templateId, reason: body.reason, unpublished_by: auth.userId, emergency: true },
  }).then(() => {}).catch(() => {});

  return success({
    template_id: templateId,
    status: 'DRAFT',
    reason: body.reason,
    message: 'Template emergency-unpublished. Returned to DRAFT.',
  });
}
