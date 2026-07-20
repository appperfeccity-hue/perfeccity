/**
 * Edge Function: customer-portal
 * Sprint 6 T4-T9 — Customer-facing endpoints (magic link auth)
 *
 * Routes:
 * - GET  /customer/v1/projects/:id/quotation  (T4: view quotation)
 * - POST /customer/v1/projects/:id/approve    (T5: approve quotation)
 * - POST /customer/v1/projects/:id/pay        (T6: initiate payment)
 * - GET  /customer/v1/projects/:id/status     (T9: track status)
 *
 * Auth: requireCustomerToken middleware (magic link, no JWT)
 * Scoping: token is bound to a specific project — middleware returns projectId
 * Forbidden keys: unit_cost_paise NEVER exposed to customer (Part 7)
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireCustomerToken } from '../_shared/middleware/customer-token.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { success, error } from '../_shared/response.ts';

serve(async (req: Request) => {
  const url = new URL(req.url);
  const method = req.method;

  // All customer portal routes require a valid token
  const tokenResult = await requireCustomerToken(req);
  if (!tokenResult.ok) return tokenResult.response;

  const { customerId, projectId } = tokenResult.context;

  // Verify the requested project matches the token's scope
  const requestedProjectId = extractProjectId(url.pathname);
  if (!requestedProjectId) {
    return error('BAD_REQUEST', 'Project ID required in path', 400);
  }
  if (requestedProjectId !== projectId) {
    // Token is scoped to a different project — deny access
    // Same error as invalid token to avoid leaking project existence
    return error('TOKEN_INVALID', 'Missing or malformed access token', 401);
  }

  try {
    const admin = getAdminClient();

    // Route: GET .../quotation
    if (method === 'GET' && url.pathname.includes('/quotation')) {
      return await handleQuotationDisplay(admin, projectId, customerId);
    }

    // Route: POST .../approve
    if (method === 'POST' && url.pathname.includes('/approve')) {
      return await handleApprove(admin, projectId, customerId);
    }

    // Route: POST .../pay
    if (method === 'POST' && url.pathname.includes('/pay')) {
      return await handlePay(admin, projectId, customerId);
    }

    // Route: GET .../status
    if (method === 'GET' && url.pathname.includes('/status')) {
      return await handleStatus(admin, projectId, customerId);
    }

    return error('NOT_FOUND', 'Endpoint not found', 404);
  } catch (e) {
    console.error('customer-portal error:', e);
    return error('INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
});

// ============================================================
// T4: Quotation Display (forbidden keys suppressed)
// ============================================================

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

async function handleQuotationDisplay(
  admin: SupabaseClient,
  projectId: string,
  _customerId: string
): Promise<Response> {
  // Get the latest sealed quotation snapshot
  const { data: snapshot, error: snapErr } = await admin
    .from('quotation_snapshots')
    .select('snapshot_id, grand_total_paise, step_breakdown, sealed_at, expires_at, status')
    .eq('project_id', projectId)
    .in('status', ['SEALED', 'EXPIRED'])
    .order('sealed_at', { ascending: false })
    .limit(1)
    .single();

  if (snapErr || !snapshot) {
    return error('QUOTATION_NOT_FOUND', 'No quotation found for this project', 404);
  }

  // Get BOM lines (suppressing unit_cost_paise — Part 7 forbidden keys)
  const { data: bomLines } = await admin
    .from('bom_lines')
    .select('sku, source, component_label, quantity, unit_label, line_total_paise')
    .eq('snapshot_id', snapshot.snapshot_id)
    .order('source', { ascending: true });

  // Get project info
  const { data: project } = await admin
    .from('projects')
    .select('customer_name, project_address, city')
    .eq('project_id', projectId)
    .single();

  // Build customer-safe response
  // FORBIDDEN KEYS (Part 7): unit_cost_paise, sell_price_paise, step_breakdown internals
  const grandTotalRupees = (snapshot.grand_total_paise / 100).toFixed(2);

  // Summarize step_breakdown for customer (only category totals, not per-item costs)
  const breakdown = snapshot.step_breakdown as Record<string, unknown>;
  const customerBreakdown = {
    materials_and_installation: breakdown.step_11_subtotal_paise
      ? `₹${((breakdown.step_11_subtotal_paise as number) / 100).toFixed(2)}`
      : null,
    margin: breakdown.step_12_margin_paise
      ? `₹${((breakdown.step_12_margin_paise as number) / 100).toFixed(2)}`
      : null,
    gst: breakdown.step_13_gst_paise
      ? `₹${((breakdown.step_13_gst_paise as number) / 100).toFixed(2)}`
      : null,
  };

  // Format BOM lines for customer (no unit costs)
  const customerBomLines = (bomLines || []).map(line => ({
    item: line.component_label,
    category: line.source,
    quantity: line.quantity,
    unit: line.unit_label,
    // line_total_paise is the cost × quantity — shown as rupees
    amount: `₹${(line.line_total_paise / 100).toFixed(2)}`,
  }));

  return success({
    quotation: {
      snapshot_id: snapshot.snapshot_id,
      status: snapshot.status,
      grand_total: `₹${grandTotalRupees}`,
      grand_total_paise: snapshot.grand_total_paise,
      sealed_at: snapshot.sealed_at,
      expires_at: snapshot.expires_at,
      is_expired: new Date(snapshot.expires_at) < new Date(),
      breakdown: customerBreakdown,
      items: customerBomLines,
    },
    project: {
      customer_name: project?.customer_name,
      address: project?.project_address,
      city: project?.city,
    },
  });
}

// ============================================================
// T5: Customer Approve (QUOTED → PAYMENT_PENDING)
// ============================================================

async function handleApprove(
  admin: SupabaseClient,
  projectId: string,
  customerId: string
): Promise<Response> {
  // Get project status
  const { data: project } = await admin
    .from('projects')
    .select('status, latest_snapshot_id')
    .eq('project_id', projectId)
    .single();

  if (!project) {
    return error('PROJECT_NOT_FOUND', 'Project not found', 404);
  }

  // Guard: project must be QUOTED
  if (project.status !== 'QUOTED') {
    return error('INVALID_STATUS',
      `Project must be in QUOTED status to approve (current: ${project.status})`, 422);
  }

  // Guard: quotation must not be expired
  if (project.latest_snapshot_id) {
    const { data: snapshot } = await admin
      .from('quotation_snapshots')
      .select('expires_at, status')
      .eq('snapshot_id', project.latest_snapshot_id)
      .single();

    if (snapshot) {
      if (snapshot.status !== 'SEALED') {
        return error('QUOTATION_NOT_SEALED',
          'Quotation is no longer sealed (may have been expired or archived)', 422);
      }
      if (new Date(snapshot.expires_at) < new Date()) {
        return error('QUOTATION_EXPIRED',
          'Quotation has expired. Please request a new quotation from your consultant.', 422);
      }
    }
  }

  // Transition: QUOTED → PAYMENT_PENDING
  await admin
    .from('projects')
    .update({ status: 'PAYMENT_PENDING', updated_at: new Date().toISOString() })
    .eq('project_id', projectId);

  // Record state transition
  await admin.from('project_state_history').insert({
    project_id: projectId,
    from_status: 'QUOTED',
    to_status: 'PAYMENT_PENDING',
    actor_id: null, // customer (no staff user_id)
    trigger_rule: 'customer_approved_quotation',
    note: `Customer ${customerId} approved the quotation`,
  });

  return success({
    project_id: projectId,
    previous_status: 'QUOTED',
    new_status: 'PAYMENT_PENDING',
    message: 'Quotation approved. You can now proceed to payment.',
  });
}

// ============================================================
// T6: Pay (Razorpay order creation) — placeholder
// ============================================================

async function handlePay(
  _admin: SupabaseClient,
  projectId: string,
  _customerId: string
): Promise<Response> {
  // T6 implementation will create Razorpay order
  // For now: return placeholder indicating this endpoint exists
  return error('NOT_IMPLEMENTED', 'Payment endpoint (T6) not yet implemented', 501);
}

// ============================================================
// T9: Status Tracking
// ============================================================

async function handleStatus(
  admin: SupabaseClient,
  projectId: string,
  _customerId: string
): Promise<Response> {
  // Get project status + scheduling info
  const { data: project } = await admin
    .from('projects')
    .select('status, customer_name, installation_scheduled_date')
    .eq('project_id', projectId)
    .single();

  if (!project) {
    return error('PROJECT_NOT_FOUND', 'Project not found', 404);
  }

  // Get payment status (if exists)
  const { data: payment } = await admin
    .from('advance_payments')
    .select('status, amount_paise, method, confirmed_at')
    .eq('project_id', projectId)
    .single();

  // Get latest quotation total
  const { data: snapshot } = await admin
    .from('quotation_snapshots')
    .select('grand_total_paise, sealed_at, expires_at, status')
    .eq('project_id', projectId)
    .order('sealed_at', { ascending: false })
    .limit(1)
    .single();

  return success({
    project: {
      status: project.status,
      customer_name: project.customer_name,
      installation_date: project.installation_scheduled_date,
    },
    payment: payment ? {
      status: payment.status,
      amount: `₹${(payment.amount_paise / 100).toFixed(2)}`,
      method: payment.method,
      confirmed_at: payment.confirmed_at,
    } : null,
    quotation: snapshot ? {
      grand_total: `₹${(snapshot.grand_total_paise / 100).toFixed(2)}`,
      sealed_at: snapshot.sealed_at,
      expires_at: snapshot.expires_at,
      status: snapshot.status,
    } : null,
  });
}

// ============================================================
// Helpers
// ============================================================

function extractProjectId(pathname: string): string | null {
  const match = pathname.match(
    /projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  return match ? match[1] : null;
}
