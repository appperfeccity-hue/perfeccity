/**
 * Installation Complete + Delivery Confirm — HTTP wrappers over Sprint 7 RPCs
 *
 * POST /api/v1/projects/:id/delivery/confirm — marks delivery as done
 * POST /api/v1/projects/:id/installation/complete — calls complete_installation RPC
 *   Transitions: project → CLOSED
 *
 * Both are Manager/Admin only.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { success, error } from '../_shared/response.ts';
import { AuthContext } from '../_shared/middleware/rbac.ts';

export async function handleDeliveryConfirm(
  admin: SupabaseClient,
  projectId: string,
  auth: AuthContext
): Promise<Response> {
  // Verify project exists and is in a state where delivery makes sense
  const { data: project } = await admin
    .from('projects')
    .select('project_id, status')
    .eq('project_id', projectId)
    .single();

  if (!project) return error('PROJECT_NOT_FOUND', 'Project not found', 404);

  // Update installation_schedules delivery_status
  const { data: schedule } = await admin
    .from('installation_schedules')
    .select('schedule_id, delivery_date, delivery_status')
    .eq('project_id', projectId)
    .single();

  if (!schedule) {
    return error('NO_SCHEDULE', 'No delivery schedule found for this project', 404);
  }

  if (schedule.delivery_status === 'DELIVERED') {
    return success({ project_id: projectId, status: 'ALREADY_DELIVERED', message: 'Delivery already confirmed' });
  }

  const { error: updateErr } = await admin
    .from('installation_schedules')
    .update({
      delivery_status: 'DELIVERED',
      updated_at: new Date().toISOString(),
    })
    .eq('schedule_id', schedule.schedule_id);

  if (updateErr) {
    return error('DB_ERROR', 'Failed to confirm delivery: ' + updateErr.message, 500);
  }

  return success({
    project_id: projectId,
    delivery_status: 'DELIVERED',
    message: 'Delivery confirmed successfully',
  });
}

export async function handleInstallationComplete(
  admin: SupabaseClient,
  projectId: string,
  auth: AuthContext
): Promise<Response> {
  // Call the complete_installation RPC (Sprint 7, gate-tested 12/12)
  const { data, error: rpcError } = await admin.rpc('complete_installation', {
    p_project_id: projectId,
    p_completed_by: auth.userId,
  });

  if (rpcError) {
    const msg = rpcError.message || '';
    // Map RPC exceptions to HTTP errors (AD-18 co-maintenance pattern)
    if (msg.includes('PROJECT_NOT_FOUND')) {
      return error('PROJECT_NOT_FOUND', 'Project not found', 404);
    }
    if (msg.includes('INVALID_STATUS')) {
      return error('INVALID_STATUS', 'Project is not in a state that allows completion', 422);
    }
    if (msg.includes('INSTALLATION_NOT_SCHEDULED')) {
      return error('INSTALLATION_NOT_SCHEDULED', 'Installation must be scheduled before completing', 422);
    }
    if (msg.includes('DELIVERY_NOT_CONFIRMED')) {
      return error('DELIVERY_NOT_CONFIRMED', 'Delivery must be confirmed before installation can complete', 422);
    }
    if (msg.includes('PACKAGE_NOT_READY')) {
      return error('PACKAGE_NOT_READY', 'Manufacturing package must be READY before installation', 422);
    }
    console.error('complete_installation RPC failed:', rpcError);
    return error('DB_ERROR', 'Failed to complete installation: ' + msg, 500);
  }

  return success({
    project_id: projectId,
    status: 'CLOSED',
    message: 'Installation completed. Project is now CLOSED.',
    result: data,
  });
}
