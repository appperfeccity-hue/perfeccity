/**
 * Edge Function: api-scheduling
 * Sprint 6 T8 — Manager Scheduling + Completion
 *
 * Endpoints:
 * - PUT  /api/v1/projects/:id/schedule/delivery      (set delivery date)
 * - PUT  /api/v1/projects/:id/schedule/installation  (set installation date)
 * - POST /api/v1/projects/:id/delivery/confirm       (mark delivery done)
 * - POST /api/v1/projects/:id/installation/complete  (close project)
 *
 * Role: ADMIN or MANAGER
 * Prerequisite: project.status = APPROVED (for scheduling)
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireAuth } from '../_shared/middleware/rbac.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { success, error } from '../_shared/response.ts';
import { handleDeliveryConfirm, handleInstallationComplete } from './complete.ts';

serve(async (req: Request) => {
  const url = new URL(req.url);
  const method = req.method;

  // RBAC: ADMIN or MANAGER only
  const rbac = await requireAuth(req, ['ADMIN', 'MANAGER']);
  if (!rbac.ok) return rbac.response;

  try {
    const admin = getAdminClient();
    const projectId = extractProjectId(url.pathname);

    if (!projectId) {
      return error('BAD_REQUEST', 'Project ID required in path', 400);
    }

    // POST routes (completion actions)
    if (method === 'POST') {
      if (url.pathname.includes('/delivery/confirm')) {
        return await handleDeliveryConfirm(admin, projectId, rbac.auth);
      }
      if (url.pathname.includes('/installation/complete')) {
        return await handleInstallationComplete(admin, projectId, rbac.auth);
      }
      return error('BAD_REQUEST', 'Unknown POST route', 400);
    }

    // PUT routes (scheduling)
    if (method !== 'PUT') {
      return error('METHOD_NOT_ALLOWED', 'Use PUT for scheduling, POST for completion', 405);
    }

    // Validate project exists and is APPROVED
    const { data: project, error: projErr } = await admin
      .from('projects')
      .select('project_id, status, manager_id')
      .eq('project_id', projectId)
      .single();

    if (projErr || !project) {
      return error('PROJECT_NOT_FOUND', 'No project found with the specified ID', 404);
    }

    if (project.status !== 'APPROVED') {
      return error('INVALID_STATUS',
        `Project must be in APPROVED status to schedule (current: ${project.status})`, 422);
    }

    // Parse request body
    const body = await req.json() as { date: string };

    if (!body.date) {
      return error('VALIDATION_ERROR', 'date field is required (ISO-8601 format)', 422, 'date');
    }

    // Validate date format
    const parsedDate = new Date(body.date);
    if (isNaN(parsedDate.getTime())) {
      return error('VALIDATION_ERROR', 'date must be a valid ISO-8601 date', 422, 'date');
    }

    // Must be in the future
    if (parsedDate <= new Date()) {
      return error('VALIDATION_ERROR', 'date must be in the future', 422, 'date');
    }

    // Route: .../schedule/delivery
    if (url.pathname.includes('/schedule/delivery')) {
      // Check if installation_schedules table has a delivery entry
      const { data: existing } = await admin
        .from('installation_schedules')
        .select('schedule_id')
        .eq('project_id', projectId)
        .single();

      if (existing) {
        // Update existing schedule
        await admin
          .from('installation_schedules')
          .update({
            scheduled_delivery_date: parsedDate.toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('schedule_id', existing.schedule_id);
      } else {
        // Create new schedule
        await admin
          .from('installation_schedules')
          .insert({
            project_id: projectId,
            scheduled_delivery_date: parsedDate.toISOString(),
            scheduled_by: rbac.auth.userId,
          });
      }

      return success({
        project_id: projectId,
        delivery_date: parsedDate.toISOString(),
        scheduled_by: rbac.auth.userId,
        message: 'Delivery date scheduled successfully',
      });
    }

    // Route: .../schedule/installation
    if (url.pathname.includes('/schedule/installation')) {
      // Update project's installation_scheduled_date
      await admin
        .from('projects')
        .update({
          installation_scheduled_date: parsedDate.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('project_id', projectId);

      // Also update installation_schedules if exists
      const { data: existing } = await admin
        .from('installation_schedules')
        .select('schedule_id')
        .eq('project_id', projectId)
        .single();

      if (existing) {
        await admin
          .from('installation_schedules')
          .update({
            scheduled_installation_date: parsedDate.toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('schedule_id', existing.schedule_id);
      } else {
        await admin
          .from('installation_schedules')
          .insert({
            project_id: projectId,
            scheduled_installation_date: parsedDate.toISOString(),
            scheduled_by: rbac.auth.userId,
          });
      }

      return success({
        project_id: projectId,
        installation_date: parsedDate.toISOString(),
        scheduled_by: rbac.auth.userId,
        message: 'Installation date scheduled successfully',
      });
    }

    return error('BAD_REQUEST', 'Must specify /schedule/delivery or /schedule/installation', 400);
  } catch (e) {
    console.error('api-scheduling error:', e);
    return error('INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
});

function extractProjectId(pathname: string): string | null {
  const match = pathname.match(
    /projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  return match ? match[1] : null;
}
