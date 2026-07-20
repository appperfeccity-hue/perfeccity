/**
 * Edge Function: api-review
 * Review Gate — Sprint 5 T1
 *
 * POST /api/v1/projects/:id/review
 * Role: owning Consultant (SALESPERSON) or ADMIN
 *
 * Delegates to the atomic `submit_review_gate` RPC (migration 00014) which:
 * 1. Evaluates the 7-item WF-4 checklist
 * 2. Inserts a review_records row (pass or fail)
 * 3. On PASS: transitions project.status → REVIEWED
 * 4. On FAIL: stays CONFIGURING, returns itemized failures
 *
 * Pre-write checklist applied:
 * - SECURITY DEFINER + SET search_path on RPC ✅
 * - Atomic multi-step write in Postgres function ✅
 * - State machine: only CONFIGURING→REVIEWED on pass ✅
 * - Response envelope: {data, errors} ✅
 * - Error codes distinct ✅
 * - No forbidden keys in response ✅
 *
 * ⚠️ CO-MAINTENANCE: RAISE EXCEPTION patterns in migration 00014
 *   are matched here for error code extraction.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireAuth } from '../_shared/middleware/rbac.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { success, error } from '../_shared/response.ts';

serve(async (req: Request) => {
  const url = new URL(req.url);
  const method = req.method;

  // Only POST is allowed
  if (method !== 'POST') {
    return error('METHOD_NOT_ALLOWED', 'Only POST is allowed for review submission', 405);
  }

  // RBAC: owning Consultant (SALESPERSON) or ADMIN
  const rbac = await requireAuth(req, ['ADMIN', 'SALESPERSON']);
  if (!rbac.ok) return rbac.response;

  try {
    const admin = getAdminClient();
    const projectId = extractProjectId(url.pathname);

    if (!projectId) {
      return error('BAD_REQUEST', 'Project ID required in path (/api/v1/projects/:id/review)', 400);
    }

    // Ownership check: Consultant must own this project (ADMIN bypasses)
    if (rbac.auth.role === 'SALESPERSON') {
      const { data: project, error: projErr } = await admin
        .from('projects')
        .select('consultant_id')
        .eq('project_id', projectId)
        .single();

      if (projErr || !project) {
        return error('PROJECT_NOT_FOUND', 'No project found with the specified ID', 404);
      }

      if (project.consultant_id !== rbac.auth.userId) {
        return error('LEAD_NOT_ASSIGNED_TO_YOU', 'You are not the assigned consultant for this project', 403);
      }
    }

    // Call the atomic RPC
    const { data: rpcResult, error: rpcError } = await admin.rpc('submit_review_gate', {
      p_project_id: projectId,
      p_reviewer_id: rbac.auth.userId,
    });

    if (rpcError) {
      // Parse structured exceptions from the RPC
      // ⚠️ CO-MAINTENANCE: matched by supabase/migrations/00014_create_review_gate_rpc.sql
      const msg = rpcError.message || '';

      if (msg.includes('PROJECT_NOT_FOUND')) {
        return error('PROJECT_NOT_FOUND', 'No project found with the specified ID', 404);
      }
      if (msg.includes('INVALID_STATUS')) {
        return error('INVALID_STATUS', 'Project must be in CONFIGURING status to submit for review', 422);
      }

      console.error('submit_review_gate RPC error:', rpcError);
      return error('INTERNAL_ERROR', 'Review gate evaluation failed', 500);
    }

    // RPC returns: { review_id, result, checklist, failure_reasons }
    const result = rpcResult as {
      review_id: string;
      result: 'PASS' | 'FAIL';
      checklist: Record<string, boolean>;
      failure_reasons: string[];
    };

    if (result.result === 'PASS') {
      return success({
        review_id: result.review_id,
        result: 'PASS',
        checklist: result.checklist,
        message: 'Review gate passed — project status is now REVIEWED',
      }, 200);
    } else {
      // FAIL — return 200 with itemized failures (it's a successful evaluation, not an error)
      return success({
        review_id: result.review_id,
        result: 'FAIL',
        checklist: result.checklist,
        failure_reasons: result.failure_reasons,
        message: 'Review gate failed — address the listed items and retry',
      }, 200);
    }
  } catch (e) {
    console.error('api-review error:', e);
    return error('INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
});

function extractProjectId(pathname: string): string | null {
  const match = pathname.match(
    /projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  return match ? match[1] : null;
}
