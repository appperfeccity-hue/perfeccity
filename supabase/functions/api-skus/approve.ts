/**
 * SKU Approve — Admin path (WF-10)
 * 
 * POST /api/v1/skus/:sku/approve
 * Role: ADMIN only
 * Body: { unit_cost_paise, sell_price_paise }
 * 
 * Calls the approve_sku_proposal RPC which performs the approval atomically:
 * status→ACTIVE + pricing set + is_active=TRUE + notification to proposer.
 * 
 * Pre-write checklist T3 (full application):
 * ✅ Postgres function: RPC for 4-step atomic operation
 * ✅ SECURITY DEFINER + search_path: in migration 00011
 * ✅ GRANT EXECUTE: to authenticated + service_role
 * ✅ FOR UPDATE row lock: prevents concurrent approval race
 * ✅ Self-approval guard (AD-20): proposed_by != approver
 * ✅ Co-maintenance markers: all RAISE EXCEPTION sites marked
 * ✅ Multi-step write: wrapped in single transaction via RPC
 * ❌ DELETE: N/A (status update)
 * ❌ FK/cascade: N/A
 * ❌ Crypto: N/A
 */

import { requireAuth } from '../_shared/middleware/rbac.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { success, error } from '../_shared/response.ts';

export async function handleApprove(req: Request): Promise<Response> {
  // RBAC: Admin only
  const rbac = await requireAuth(req, ['ADMIN']);
  if (!rbac.ok) return rbac.response;

  const url = new URL(req.url);
  const sku = extractSku(url.pathname);
  if (!sku) return error('BAD_REQUEST', 'SKU code required in path', 400);

  const body = await req.json();

  // Validate pricing fields are present (required by the RPC, but validate early for UX)
  if (!body.unit_cost_paise || typeof body.unit_cost_paise !== 'number' || body.unit_cost_paise <= 0) {
    return error('VALIDATION_ERROR', 'unit_cost_paise must be a positive integer (paise)', 422, 'unit_cost_paise');
  }
  if (!body.sell_price_paise || typeof body.sell_price_paise !== 'number' || body.sell_price_paise <= 0) {
    return error('VALIDATION_ERROR', 'sell_price_paise must be a positive integer (paise)', 422, 'sell_price_paise');
  }

  const admin = getAdminClient();

  // Call the atomic RPC (AD-5, AD-6, AD-11, AD-18, AD-20 all applied)
  const { data, error: rpcError } = await admin.rpc('approve_sku_proposal', {
    p_sku: sku,
    p_approver_id: rbac.auth.userId,
    p_unit_cost_paise: body.unit_cost_paise,
    p_sell_price_paise: body.sell_price_paise,
  });

  if (rpcError) {
    return mapRpcError(rpcError, sku);
  }

  return success(data);
}

/**
 * Maps Postgres RPC errors to appropriate HTTP responses.
 * ⚠️ CO-MAINTENANCE: these match the RAISE EXCEPTION messages in
 * supabase/migrations/00011_create_sku_approval_rpc.sql.
 * Do not rename exception messages without updating both files.
 */
function mapRpcError(
  rpcError: { message: string; code?: string; details?: string; hint?: string },
  sku: string
): Response {
  const msg = rpcError.message || '';
  const hint = rpcError.hint || '';

  if (msg.includes('INVALID_PRICING')) {
    return error('VALIDATION_ERROR', hint || 'Pricing must be positive integers (paise)', 422, 'unit_cost_paise');
  }
  if (msg.includes('SKU_NOT_FOUND')) {
    return error('SKU_NOT_FOUND', `No SKU found with code '${sku}'`, 404);
  }
  if (msg.includes('SKU_NOT_PROPOSED')) {
    return error('SKU_NOT_PROPOSED', hint || 'Only SKUs with status PROPOSED can be approved', 409);
  }
  if (msg.includes('SELF_APPROVAL_NOT_ALLOWED')) {
    return error('SELF_APPROVAL_NOT_ALLOWED', hint || 'You cannot approve a SKU you proposed (AD-20)', 422);
  }

  // Unknown RPC error
  console.error('Unknown approve_sku_proposal RPC error:', rpcError);
  return error('APPROVAL_FAILED', 'SKU approval failed: ' + msg, 500);
}

function extractSku(pathname: string): string | null {
  const match = pathname.match(/skus\/([A-Z0-9\-]+)/i);
  return match ? match[1] : null;
}
