/**
 * Submit for Review — Sprint 3 T7
 *
 * POST /api/v1/design-library/:id/submit-review
 * Role: DESIGNER (own), ADMIN
 * Transition: DRAFT → READY_FOR_REVIEW
 * Gate: all 10 validation checks must PASS
 *
 * Side effects:
 * 1. Status → READY_FOR_REVIEW
 * 2. Notification to ADMIN (TEMPLATE_SUBMITTED_FOR_REVIEW)
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { success, error } from '../_shared/response.ts';
import { AuthContext } from '../_shared/middleware/rbac.ts';
import { runValidation } from './validate.ts';

export async function handleSubmitReview(
  admin: SupabaseClient,
  templateId: string,
  auth: AuthContext
): Promise<Response> {
  // Fetch template
  const { data: template } = await admin
    .from('design_templates')
    .select('template_id, status, created_by, template_name')
    .eq('template_id', templateId)
    .single();

  if (!template) return error('TEMPLATE_NOT_FOUND', 'Template not found', 404);

  // Only DRAFT can be submitted
  if (template.status !== 'DRAFT') {
    return error('INVALID_STATUS_TRANSITION',
      `Cannot submit: template is '${template.status}', must be DRAFT`, 422);
  }

  // Designers can only submit their own
  if (auth.role === 'DESIGNER' && template.created_by !== auth.userId) {
    return error('FORBIDDEN', 'Designers can only submit their own templates', 403);
  }

  // Gate: all 10 validation checks must PASS
  const validationResults = await runValidation(admin, templateId);
  const failedChecks = validationResults.filter(r => !r.passed);

  if (failedChecks.length > 0) {
    return error('VALIDATION_INCOMPLETE',
      `Cannot submit: ${failedChecks.length} validation check(s) failed — ` +
      failedChecks.map(c => `#${c.check_number} ${c.check_name}`).join(', '),
      422);
  }

  // Transition: DRAFT → READY_FOR_REVIEW
  const { error: updateErr } = await admin
    .from('design_templates')
    .update({
      status: 'READY_FOR_REVIEW',
      updated_at: new Date().toISOString(),
    })
    .eq('template_id', templateId);

  if (updateErr) {
    return error('DB_ERROR', 'Failed to update status: ' + updateErr.message, 500);
  }

  // Notification to ADMIN (best-effort — failure doesn't corrupt state)
  await admin.from('notifications').insert({
    recipient_role: 'ADMIN',
    notification_type: 'TEMPLATE_SUBMITTED_FOR_REVIEW',
    title: `Template submitted for review: ${template.template_name}`,
    body: `Template "${template.template_name}" has been submitted for review by ${auth.role}.`,
    metadata: { template_id: templateId, submitted_by: auth.userId },
  }).then(() => {}).catch(() => {});

  return success({
    template_id: templateId,
    status: 'READY_FOR_REVIEW',
    validation: { all_passed: true, checks_count: validationResults.length },
    message: 'Template submitted for review successfully',
  });
}
