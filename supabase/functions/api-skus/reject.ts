/**
 * SKU Reject — Admin path (WF-10)
 * 
 * POST /api/v1/skus/:sku/reject
 * Role: ADMIN only
 * Body: { reason } (required)
 * 
 * Transitions PROPOSED → REJECTED, notifies Designer (SKU_REJECTED).
 * 
 * Pre-write checklist (T4):
 * - Multi-step write: status update + notification = 2 steps
 *   Assessment: notification failure doesn't corrupt state (SKU is correctly
 *   REJECTED regardless). Unlike approve (where missing notification means
 *   Designer doesn't know their SKU is live), a missing rejection notification
 *   just means the Designer discovers it when they check the Submissions view.
 *   Decision: two calls acceptable (not RPC). Same reasoning as AD-21 candidate
 *   for template submit.
 * - No row lock needed: rejecting an already-rejected SKU is idempotent (no-op),
 *   and PROPOSED→REJECTED doesn't have a "second writer wins incorrectly" race.
 * - No DELETE, no FK concern, no crypto, no self-approval (reject ≠ approve).
 */

import { requireAuth } from '../_shared/middleware/rbac.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { success, error } from '../_shared/response.ts';

export async function handleReject(req: Request): Promise<Response> {
  const rbac = await requireAuth(req, ['ADMIN']);
  if (!rbac.ok) return rbac.response;

  const url = new URL(req.url);
  const sku = extractSku(url.pathname);
  if (!sku) return error('BAD_REQUEST', 'SKU code required in path', 400);

  const body = await req.json();

  // Reason is required (Part 4, WF-10: "Reject requires reason")
  if (!body.reason || body.reason.trim() === '') {
    return error('VALIDATION_ERROR', 'reason is required when rejecting a SKU proposal', 422, 'reason');
  }

  const admin = getAdminClient();

  // Update status: PROPOSED → REJECTED
  // Only reject if currently PROPOSED (idempotent: already REJECTED = no-op error)
  const { data: updated, error: updateError } = await admin
    .from('product_library')
    .update({
      status: 'REJECTED',
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('sku', sku)
    .eq('status', 'PROPOSED') // Only transition from PROPOSED
    .select('sku, name, status, proposed_by')
    .single();

  if (updateError || !updated) {
    // Check if SKU exists at all
    const { data: existing } = await admin
      .from('product_library')
      .select('sku, status')
      .eq('sku', sku)
      .single();

    if (!existing) {
      return error('SKU_NOT_FOUND', `No SKU found with code '${sku}'`, 404);
    }
    if (existing.status !== 'PROPOSED') {
      return error('SKU_NOT_PROPOSED', `SKU status is '${existing.status}', not PROPOSED. Only PROPOSED SKUs can be rejected.`, 409);
    }
    return error('DB_ERROR', 'Failed to reject SKU', 500);
  }

  // Notification to proposer (non-blocking — failure doesn't corrupt state)
  if (updated.proposed_by) {
    const { error: notifError } = await admin.from('notifications').insert({
      recipient_id: updated.proposed_by,
      type: 'SKU_REJECTED',
      message: `Your SKU proposal "${updated.name}" (${sku}) was rejected. Reason: ${body.reason}`,
    });
    if (notifError) {
      console.error('Non-fatal: SKU rejection notification failed:', notifError);
    }
  }

  return success({
    ...updated,
    rejection_reason: body.reason,
  });
}

function extractSku(pathname: string): string | null {
  const match = pathname.match(/skus\/([A-Z0-9\-]+)/i);
  return match ? match[1] : null;
}
