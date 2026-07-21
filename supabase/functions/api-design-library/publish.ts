/**
 * Publish + Request Changes — Sprint 3 T7
 *
 * POST /api/v1/design-library/:id/publish
 *   Role: ADMIN only
 *   Transition: READY_FOR_REVIEW → PUBLISHED
 *   Sets published_at
 *
 * POST /api/v1/design-library/:id/request-changes
 *   Role: ADMIN only
 *   Transition: READY_FOR_REVIEW → DRAFT
 *   Body: { comment } (required)
 *   Notification to Designer (TEMPLATE_CHANGES_REQUESTED)
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { success, error } from '../_shared/response.ts';
import { AuthContext } from '../_shared/middleware/rbac.ts';

export async function handlePublish(
  admin: SupabaseClient,
  templateId: string,
  auth: AuthContext
): Promise<Response> {
  // Fetch template
  const { data: template } = await admin
    .from('design_templates')
    .select('template_id, status, template_name, created_by')
    .eq('template_id', templateId)
    .single();

  if (!template) return error('TEMPLATE_NOT_FOUND', 'Template not found', 404);

  // Only READY_FOR_REVIEW can be published
  if (template.status !== 'READY_FOR_REVIEW') {
    return error('INVALID_STATUS_TRANSITION',
      `Cannot publish: template is '${template.status}', must be READY_FOR_REVIEW`, 422);
  }

  const now = new Date().toISOString();

  // Transition: READY_FOR_REVIEW → PUBLISHED
  const { error: updateErr } = await admin
    .from('design_templates')
    .update({
      status: 'PUBLISHED',
      published_at: now,
      updated_at: now,
    })
    .eq('template_id', templateId);

  if (updateErr) {
    return error('DB_ERROR', 'Failed to publish: ' + updateErr.message, 500);
  }

  return success({
    template_id: templateId,
    status: 'PUBLISHED',
    published_at: now,
    message: 'Template published successfully',
  });
}

export async function handleRequestChanges(
  admin: SupabaseClient,
  templateId: string,
  auth: AuthContext,
  body: { comment?: string }
): Promise<Response> {
  // Comment is required
  if (!body.comment || body.comment.trim() === '') {
    return error('VALIDATION_ERROR', 'comment is required when requesting changes', 422, 'comment');
  }

  // Fetch template
  const { data: template } = await admin
    .from('design_templates')
    .select('template_id, status, template_name, created_by')
    .eq('template_id', templateId)
    .single();

  if (!template) return error('TEMPLATE_NOT_FOUND', 'Template not found', 404);

  // Only READY_FOR_REVIEW can have changes requested
  if (template.status !== 'READY_FOR_REVIEW') {
    return error('INVALID_STATUS_TRANSITION',
      `Cannot request changes: template is '${template.status}', must be READY_FOR_REVIEW`, 422);
  }

  // Transition: READY_FOR_REVIEW → DRAFT
  const { error: updateErr } = await admin
    .from('design_templates')
    .update({
      status: 'DRAFT',
      updated_at: new Date().toISOString(),
    })
    .eq('template_id', templateId);

  if (updateErr) {
    return error('DB_ERROR', 'Failed to update status: ' + updateErr.message, 500);
  }

  // Notification to Designer (best-effort)
  if (template.created_by) {
    const { error: notifError } = await admin.from('notifications').insert({
      recipient_id: template.created_by,
      type: 'TEMPLATE_CHANGES_REQUESTED',
      message: `Changes requested on "${template.template_name}": ${body.comment}`,
    });
    if (notifError) {
      console.error('Non-fatal: request-changes notification failed:', notifError);
    }
  }

  return success({
    template_id: templateId,
    status: 'DRAFT',
    comment: body.comment,
    message: 'Changes requested — template returned to DRAFT',
  });
}
