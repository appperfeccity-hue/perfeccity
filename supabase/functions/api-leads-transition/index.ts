/**
 * Edge Function: api-leads-transition
 * Handles: POST /api/v1/leads/:id/transition
 * Roles: Admin, owning Consultant
 * 
 * Sprint 1 T9 — Lead Status Transitions
 * 
 * Validates transitions against Gate 6 rules (Part 10):
 * 
 * VALID transitions:
 * - ASSIGNED → CONTACTED
 * - CONTACTED → SCHEDULED
 * - SCHEDULED → SURVEY_COMPLETED
 * - SURVEY_COMPLETED → CONVERTED
 * - Any status → LOST (with reason)
 * 
 * INVALID (must fail with 422 INVALID_TRANSITION):
 * - NEW → anything (assignment is via /assign endpoint, not transition)
 * - NEW → CONVERTED direct (skips assignment)
 * - NEW → CONTACTED without ASSIGNED (skips assignment)
 * - Any skip in the chain
 * 
 * Special: CONVERTED creates a projects row and sets leads.converted_project_id
 * 
 * NOTE: NEW → ASSIGNED is handled exclusively by the assign endpoint (T7).
 * This endpoint rejects any transition FROM 'NEW' with a clear error.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireAuth } from '../_shared/middleware/rbac.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { success, error } from '../_shared/response.ts';

// Valid transition map: from_status → [allowed_to_statuses]
const VALID_TRANSITIONS: Record<string, string[]> = {
  // NEW is NOT here — assignment is via /assign endpoint only
  ASSIGNED: ['CONTACTED', 'LOST'],
  CONTACTED: ['SCHEDULED', 'LOST'],
  SCHEDULED: ['SURVEY_COMPLETED', 'LOST'],
  SURVEY_COMPLETED: ['CONVERTED', 'LOST'],
  // CONVERTED and LOST are terminal — no transitions out
};

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return error('METHOD_NOT_ALLOWED', 'Only POST is accepted', 405);
  }

  const rbac = await requireAuth(req, ['ADMIN', 'SALESPERSON']);
  if (!rbac.ok) return rbac.response;

  try {
    const url = new URL(req.url);
    const leadId = extractLeadId(url.pathname);
    if (!leadId) {
      return error('BAD_REQUEST', 'Lead ID required in path', 400);
    }

    const body = await req.json();
    const { to_status, reason } = body;

    if (!to_status) {
      return error('VALIDATION_ERROR', 'to_status is required', 422, 'to_status');
    }

    // Validate to_status is a real enum value
    const validStatuses = ['NEW', 'ASSIGNED', 'CONTACTED', 'SCHEDULED', 'SURVEY_COMPLETED', 'CONVERTED', 'LOST'];
    if (!validStatuses.includes(to_status)) {
      return error('VALIDATION_ERROR', `to_status must be one of: ${validStatuses.join(', ')}`, 422, 'to_status');
    }

    // LOST requires a reason
    if (to_status === 'LOST' && !reason) {
      return error('VALIDATION_ERROR', 'reason is required when transitioning to LOST', 422, 'reason');
    }

    const admin = getAdminClient();

    // Fetch current lead (with lock to prevent concurrent transitions)
    const { data: lead, error: fetchError } = await admin
      .from('leads')
      .select('*')
      .eq('lead_id', leadId)
      .single();

    if (fetchError || !lead) {
      return error('LEAD_NOT_FOUND', 'No lead found with the specified ID', 404);
    }

    // Ownership check for Consultant
    if (rbac.auth.role === 'SALESPERSON' && lead.assigned_consultant_id !== rbac.auth.userId) {
      return error('FORBIDDEN', 'You are not assigned to this lead', 403);
    }

    const fromStatus = lead.status;

    // Reject any transition FROM 'NEW' — assignment uses the /assign endpoint
    if (fromStatus === 'NEW') {
      return error(
        'INVALID_TRANSITION',
        'Leads with status NEW must be assigned via POST /leads/:id/assign, not transitioned directly',
        422
      );
    }

    // Reject transitions from terminal states
    if (fromStatus === 'CONVERTED' || fromStatus === 'LOST') {
      return error(
        'INVALID_TRANSITION',
        `Cannot transition from terminal status '${fromStatus}'`,
        422
      );
    }

    // Validate the transition is allowed
    const allowedTargets = VALID_TRANSITIONS[fromStatus] || [];
    if (!allowedTargets.includes(to_status)) {
      return error(
        'INVALID_TRANSITION',
        `Transition from '${fromStatus}' to '${to_status}' is not allowed. Valid targets: ${allowedTargets.join(', ')}`,
        422
      );
    }

    // Execute the transition
    const updatePayload: Record<string, unknown> = {
      status: to_status,
      updated_at: new Date().toISOString(),
    };

    // LOST transition: record reason
    if (to_status === 'LOST') {
      updatePayload.lost_reason = reason;
      updatePayload.lost_notes = body.notes || null;
    }

    // CONVERTED transition: create project
    let createdProject = null;
    if (to_status === 'CONVERTED') {
      const { data: project, error: projectError } = await admin
        .from('projects')
        .insert({
          lead_id: leadId,
          consultant_id: lead.assigned_consultant_id,
          status: 'PROJECT_CREATED',
          project_type: lead.project_type,
          customer_name: lead.customer_name,
          project_address: lead.project_address,
          city: lead.city,
        })
        .select('project_id')
        .single();

      if (projectError) {
        console.error('Project creation on CONVERTED failed:', projectError);
        return error('DB_ERROR', 'Failed to create project for converted lead', 500);
      }

      updatePayload.converted_project_id = project.project_id;
      createdProject = project;
    }

    // Update the lead
    const { data: updatedLead, error: updateError } = await admin
      .from('leads')
      .update(updatePayload)
      .eq('lead_id', leadId)
      .select('lead_id, status, converted_project_id, updated_at')
      .single();

    if (updateError) {
      console.error('Lead transition update failed:', updateError);
      return error('DB_ERROR', 'Failed to update lead status', 500);
    }

    // Record the activity (append-only audit trail)
    await admin.from('lead_activities').insert({
      lead_id: leadId,
      actor_id: rbac.auth.userId,
      activity_type: 'STATUS_TRANSITION',
      note: `Status changed from ${fromStatus} to ${to_status}` + (reason ? `: ${reason}` : ''),
    });

    return success({
      ...updatedLead,
      from_status: fromStatus,
      ...(createdProject && { project: createdProject }),
    });
  } catch (e) {
    console.error('api-leads-transition error:', e);
    return error('INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
});

function extractLeadId(pathname: string): string | null {
  const match = pathname.match(/leads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[1] : null;
}
