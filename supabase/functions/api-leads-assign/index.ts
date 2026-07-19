/**
 * Edge Function: api-leads-assign
 * Handles: POST /api/v1/leads/:id/assign
 * Roles: Manager (primary), Admin (override) — Part 2 permission matrix
 * 
 * Sprint 1 T7 — Lead Assignment (WF-2)
 * 
 * Calls the assign_lead_to_consultant Postgres RPC function which performs
 * the entire assignment atomically (AD-6):
 * - Guard (409 if not NEW)
 * - Status → ASSIGNED
 * - lead_activities audit row
 * - notification to Consultant
 * 
 * Maps Postgres exceptions to HTTP error codes:
 * - P0001 (LEAD_NOT_FOUND) → 404
 * - P0002 (LEAD_ALREADY_ASSIGNED) → 409
 * - P0003 (CONSULTANT_NOT_FOUND) → 404
 * - P0004 (NOT_A_CONSULTANT) → 422
 * - P0005 (CONSULTANT_INACTIVE) → 422
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireAuth } from '../_shared/middleware/rbac.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { success, error } from '../_shared/response.ts';

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return error('METHOD_NOT_ALLOWED', 'Only POST is accepted', 405);
  }

  // RBAC: Manager (primary) or Admin (override)
  const rbac = await requireAuth(req, ['MANAGER', 'ADMIN']);
  if (!rbac.ok) return rbac.response;

  try {
    const url = new URL(req.url);
    const leadId = extractLeadId(url.pathname);
    if (!leadId) {
      return error('BAD_REQUEST', 'Lead ID required in path', 400);
    }

    const body = await req.json();
    const { consultant_id } = body;

    if (!consultant_id) {
      return error('VALIDATION_ERROR', 'consultant_id is required', 422, 'consultant_id');
    }

    // Validate UUID format
    if (!isValidUuid(consultant_id)) {
      return error('VALIDATION_ERROR', 'consultant_id must be a valid UUID', 422, 'consultant_id');
    }

    const admin = getAdminClient();

    // Call the atomic RPC function (AD-5, AD-6)
    const { data, error: rpcError } = await admin.rpc('assign_lead_to_consultant', {
      p_lead_id: leadId,
      p_consultant_id: consultant_id,
      p_manager_id: rbac.auth.userId,
    });

    if (rpcError) {
      // Map Postgres exception codes to HTTP responses
      return mapRpcError(rpcError);
    }

    return success(data, 200);
  } catch (e) {
    console.error('api-leads-assign error:', e);
    return error('INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
});

/**
 * Maps Postgres RPC errors to appropriate HTTP responses.
 * The RPC function raises exceptions with specific ERRCODE values
 * that we map to user-facing error codes.
 */
function mapRpcError(rpcError: { message: string; code?: string; details?: string; hint?: string }): Response {
  const msg = rpcError.message || '';
  const hint = rpcError.hint || '';

  if (msg.includes('LEAD_NOT_FOUND')) {
    return error('LEAD_NOT_FOUND', 'No lead found with the specified ID', 404);
  }
  if (msg.includes('LEAD_ALREADY_ASSIGNED')) {
    return error('LEAD_ALREADY_ASSIGNED', hint || 'This lead has already been assigned and cannot be reassigned', 409);
  }
  if (msg.includes('CONSULTANT_NOT_FOUND')) {
    return error('CONSULTANT_NOT_FOUND', 'The specified consultant does not exist', 404);
  }
  if (msg.includes('NOT_A_CONSULTANT')) {
    return error('NOT_A_CONSULTANT', hint || 'The specified user is not a Design Consultant', 422);
  }
  if (msg.includes('CONSULTANT_INACTIVE')) {
    return error('CONSULTANT_INACTIVE', hint || 'The specified consultant account is not active', 422);
  }

  // Unknown RPC error — log and return generic
  console.error('Unknown RPC error:', rpcError);
  return error('ASSIGNMENT_FAILED', 'Lead assignment failed: ' + msg, 500);
}

function extractLeadId(pathname: string): string | null {
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const match = pathname.match(uuidRegex);
  return match ? match[0] : null;
}

function isValidUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}
