/**
 * Edge Function: api-leads-activities
 * Handles: POST /api/v1/leads/:id/activities
 * Roles: Admin, owning Consultant
 * 
 * Sprint 1 T9 — Lead Activities (audit trail)
 * 
 * APPEND-ONLY ENFORCEMENT:
 * This table is an audit trail — its value depends on immutability.
 * - INSERT: Admin, owning Consultant (via this endpoint)
 * - UPDATE: NEVER (no UPDATE policy exists in RLS — 00006 uses FOR ALL which
 *   technically allows it, but this endpoint only exposes INSERT. The RLS policy
 *   for lead_activities should be tightened to FOR INSERT + FOR SELECT only.)
 * - DELETE: NEVER (not exposed in any endpoint, no DELETE policy needed)
 * 
 * NOTE: The current RLS uses FOR ALL for the consultant policy — this is a gap
 * identified during T9 implementation. It should be split into separate
 * FOR SELECT and FOR INSERT policies to enforce append-only at the RLS layer,
 * not just at the endpoint layer. Fixing in this commit.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireAuth } from '../_shared/middleware/rbac.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { success, error } from '../_shared/response.ts';

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return error('METHOD_NOT_ALLOWED', 'Only POST is accepted', 405);
  }

  // RBAC: Admin or Consultant (ownership checked below)
  const rbac = await requireAuth(req, ['ADMIN', 'SALESPERSON']);
  if (!rbac.ok) return rbac.response;

  try {
    const url = new URL(req.url);
    const leadId = extractLeadId(url.pathname);
    if (!leadId) {
      return error('BAD_REQUEST', 'Lead ID required in path', 400);
    }

    const body = await req.json();
    const { activity_type, note } = body;

    if (!activity_type) {
      return error('VALIDATION_ERROR', 'activity_type is required', 422, 'activity_type');
    }

    const admin = getAdminClient();

    // Ownership check: Consultant must be assigned to this lead
    if (rbac.auth.role === 'SALESPERSON') {
      const { data: lead } = await admin
        .from('leads')
        .select('assigned_consultant_id')
        .eq('lead_id', leadId)
        .single();

      if (!lead) {
        return error('LEAD_NOT_FOUND', 'No lead found with the specified ID', 404);
      }
      if (lead.assigned_consultant_id !== rbac.auth.userId) {
        return error('FORBIDDEN', 'You are not assigned to this lead', 403);
      }
    }

    // INSERT only — append-only audit trail
    const { data: activity, error: insertError } = await admin
      .from('lead_activities')
      .insert({
        lead_id: leadId,
        actor_id: rbac.auth.userId,
        activity_type,
        note: note || null,
      })
      .select('activity_id, lead_id, actor_id, activity_type, note, created_at')
      .single();

    if (insertError) {
      console.error('Activity insert failed:', insertError);
      return error('DB_ERROR', 'Failed to record activity', 500);
    }

    return success(activity, 201);
  } catch (e) {
    console.error('api-leads-activities error:', e);
    return error('INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
});

function extractLeadId(pathname: string): string | null {
  const match = pathname.match(/leads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[1] : null;
}
