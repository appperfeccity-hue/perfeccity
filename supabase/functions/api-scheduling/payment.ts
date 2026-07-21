/**
 * Manual Payment Confirmation — for CASH/BANK_TRANSFER/CHEQUE
 *
 * POST /api/v1/projects/:id/payment/confirm-manual
 * Role: ADMIN or MANAGER
 *
 * For non-Razorpay payment methods (CASH, BANK_TRANSFER, CHEQUE), the payment
 * confirmation comes from a human (Manager/Admin) rather than a webhook.
 * This endpoint performs the same state transition as the Razorpay webhook:
 *   advance_payments.status → CONFIRMED
 *   project.status → APPROVED (PAYMENT_PENDING → APPROVED)
 *
 * Body: { method: 'CASH'|'BANK_TRANSFER'|'CHEQUE', reference?: string }
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { success, error } from '../_shared/response.ts';
import { AuthContext } from '../_shared/middleware/rbac.ts';

const MANUAL_METHODS = ['CASH', 'BANK_TRANSFER', 'CHEQUE'];

export async function handleManualPaymentConfirm(
  admin: SupabaseClient,
  projectId: string,
  auth: AuthContext,
  body: { method?: string; reference?: string; amount_paise?: number }
): Promise<Response> {
  if (!body.method || !MANUAL_METHODS.includes(body.method)) {
    return error('VALIDATION_ERROR',
      `method must be one of: ${MANUAL_METHODS.join(', ')}`, 422, 'method');
  }

  // Get project
  const { data: project } = await admin
    .from('projects')
    .select('project_id, status, latest_snapshot_id')
    .eq('project_id', projectId)
    .single();

  if (!project) return error('PROJECT_NOT_FOUND', 'Project not found', 404);
  if (project.status !== 'PAYMENT_PENDING') {
    return error('INVALID_STATUS',
      `Project must be PAYMENT_PENDING (current: ${project.status})`, 422);
  }

  // Get expected amount from sealed quotation
  const { data: snapshot } = await admin
    .from('quotation_snapshots')
    .select('grand_total_paise')
    .eq('snapshot_id', project.latest_snapshot_id)
    .single();

  const expectedAmount = snapshot?.grand_total_paise || 0;

  // Create or update advance_payments
  const { data: existingPayment } = await admin
    .from('advance_payments')
    .select('payment_id')
    .eq('project_id', projectId)
    .single();

  const now = new Date().toISOString();

  if (existingPayment) {
    await admin.from('advance_payments').update({
      method: body.method,
      status: 'CONFIRMED',
      confirmed_at: now,
      confirmed_by: auth.userId,
    }).eq('payment_id', existingPayment.payment_id);
  } else {
    await admin.from('advance_payments').insert({
      project_id: projectId,
      amount_paise: body.amount_paise || expectedAmount,
      method: body.method,
      status: 'CONFIRMED',
      confirmed_at: now,
      confirmed_by: auth.userId,
    });
  }

  // Transition project PAYMENT_PENDING → APPROVED
  await admin.from('projects').update({
    status: 'APPROVED',
    updated_at: now,
  }).eq('project_id', projectId);

  // Audit trail
  await admin.from('project_state_history').insert({
    project_id: projectId,
    from_status: 'PAYMENT_PENDING',
    to_status: 'APPROVED',
    actor_id: auth.userId,
    trigger_rule: 'manual_payment_confirmed',
    note: `Manual ${body.method} payment confirmed${body.reference ? ` (ref: ${body.reference})` : ''}`,
  });

  return success({
    project_id: projectId,
    status: 'APPROVED',
    payment_method: body.method,
    confirmed_by: auth.userId,
    reference: body.reference || null,
    message: 'Payment confirmed manually. Project moved to APPROVED.',
  });
}
