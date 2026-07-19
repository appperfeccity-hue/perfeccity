/**
 * Edge Function: api-consultation
 * Router for consultation stage endpoints.
 * 
 * Handles:
 * - GET /api/v1/projects/:id/consultation/progress
 * - PUT /api/v1/projects/:id/consultation/stage/1
 * - PUT /api/v1/projects/:id/consultation/stage/2
 * - PUT /api/v1/projects/:id/consultation/stage/3
 * - PUT /api/v1/projects/:id/consultation/stage/4
 * 
 * Stages 5–7 are Sprint 4 (not handled here).
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireAuth } from '../_shared/middleware/rbac.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { error } from '../_shared/response.ts';
import { handleStage1 } from './stage-1.ts';
import { handleStage2 } from './stage-2.ts';
import { handleStage3 } from './stage-3.ts';
import { handleStage4 } from './stage-4.ts';
import { handleProgress } from './progress.ts';

serve(async (req: Request) => {
  const url = new URL(req.url);
  const method = req.method;

  // RBAC: all consultation endpoints require SALESPERSON (owning Consultant)
  // Ownership is checked per-stage in the handlers via requireProjectOwnership
  const rbac = await requireAuth(req, ['ADMIN', 'SALESPERSON']);
  if (!rbac.ok) return rbac.response;

  try {
    const admin = getAdminClient();
    const projectId = extractProjectId(url.pathname);

    if (!projectId) {
      return error('BAD_REQUEST', 'Project ID required in path', 400);
    }

    // Route: GET .../progress
    if (method === 'GET' && url.pathname.includes('/progress')) {
      return await handleProgress(admin, projectId, rbac.auth);
    }

    // Route: PUT .../stage/N
    if (method === 'PUT') {
      const stageNumber = extractStageNumber(url.pathname);
      if (!stageNumber) {
        return error('BAD_REQUEST', 'Stage number required (1-4)', 400);
      }

      const body = await req.json();

      switch (stageNumber) {
        case 1: return await handleStage1(admin, projectId, rbac.auth, body);
        case 2: return await handleStage2(admin, projectId, rbac.auth, body);
        case 3: return await handleStage3(admin, projectId, rbac.auth, body);
        case 4: return await handleStage4(admin, projectId, rbac.auth, body);
        case 5:
        case 6:
        case 7:
          return error('NOT_IMPLEMENTED', `Stage ${stageNumber} is Sprint 4`, 501);
        default:
          return error('BAD_REQUEST', 'Stage number must be 1-7', 400);
      }
    }

    return error('METHOD_NOT_ALLOWED', 'Method not allowed', 405);
  } catch (e) {
    console.error('api-consultation error:', e);
    return error('INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
});

function extractProjectId(pathname: string): string | null {
  const match = pathname.match(
    /projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  return match ? match[1] : null;
}

function extractStageNumber(pathname: string): number | null {
  const match = pathname.match(/stage\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}
