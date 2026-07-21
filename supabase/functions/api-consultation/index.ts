/**
 * Edge Function: api-consultation
 * Router for consultation stage endpoints.
 * 
 * Handles:
 * - GET  /api/v1/projects/:id/consultation/progress
 * - PUT  /api/v1/projects/:id/consultation/stage/1..7
 * - POST /api/v1/projects/:id/spaces/:space_id/select-template (Stage 5)
 * - POST /api/v1/projects/:id/spaces/:space_id/verify-samples (Stage 5)
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireAuth } from '../_shared/middleware/rbac.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { error } from '../_shared/response.ts';
import { handleStage1 } from './stage-1.ts';
import { handleStage2 } from './stage-2.ts';
import { handleStage3 } from './stage-3.ts';
import { handleStage4 } from './stage-4.ts';
import { handleSelectTemplate, handleVerifySamples } from './stage-5.ts';
import { handleStage6 } from './stage-6.ts';
import { handleProgress } from './progress.ts';
import { handleRunRecommendation, handleGetRecommendation } from './recommendation.ts';
import { handleListFurniture, handleAddFurniture, handleRemoveFurniture } from './furniture.ts';

serve(async (req: Request) => {
  const url = new URL(req.url);
  const method = req.method;

  // RBAC: all consultation endpoints require SALESPERSON (owning Consultant)
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

    // Route: POST .../spaces/:space_id/recommendation (Stage 5a — run engine)
    if (method === 'POST' && url.pathname.includes('/recommendation')) {
      const spaceId = extractSpaceId(url.pathname);
      if (!spaceId) return error('BAD_REQUEST', 'Space ID required in path', 400);
      return await handleRunRecommendation(admin, projectId, spaceId, rbac.auth);
    }

    // Route: GET .../spaces/:space_id/recommendation (read cached)
    if (method === 'GET' && url.pathname.includes('/recommendation')) {
      const spaceId = extractSpaceId(url.pathname);
      if (!spaceId) return error('BAD_REQUEST', 'Space ID required in path', 400);
      return await handleGetRecommendation(admin, projectId, spaceId, rbac.auth);
    }

    // Route: GET .../spaces/:space_id/furniture (list)
    if (method === 'GET' && url.pathname.includes('/furniture')) {
      const spaceId = extractSpaceId(url.pathname);
      if (!spaceId) return error('BAD_REQUEST', 'Space ID required in path', 400);
      return await handleListFurniture(admin, projectId, spaceId, rbac.auth);
    }

    // Route: POST .../spaces/:space_id/furniture (add)
    if (method === 'POST' && url.pathname.includes('/furniture')) {
      const spaceId = extractSpaceId(url.pathname);
      if (!spaceId) return error('BAD_REQUEST', 'Space ID required in path', 400);
      const body = await req.json();
      return await handleAddFurniture(admin, projectId, spaceId, rbac.auth, body);
    }

    // Route: DELETE .../spaces/:space_id/furniture/:id (remove)
    if (method === 'DELETE' && url.pathname.includes('/furniture/')) {
      const spaceId = extractSpaceId(url.pathname);
      if (!spaceId) return error('BAD_REQUEST', 'Space ID required in path', 400);
      const furnitureId = extractFurnitureId(url.pathname);
      if (!furnitureId) return error('BAD_REQUEST', 'Furniture ID required in path', 400);
      return await handleRemoveFurniture(admin, projectId, spaceId, furnitureId, rbac.auth);
    }

    // Route: POST .../spaces/:space_id/select-template (Stage 5a)
    if (method === 'POST' && url.pathname.includes('/select-template')) {
      const spaceId = extractSpaceId(url.pathname);
      if (!spaceId) return error('BAD_REQUEST', 'Space ID required in path', 400);
      const body = await req.json();
      return await handleSelectTemplate(admin, projectId, spaceId, rbac.auth, body);
    }

    // Route: POST .../spaces/:space_id/verify-samples (Stage 5b)
    if (method === 'POST' && url.pathname.includes('/verify-samples')) {
      const spaceId = extractSpaceId(url.pathname);
      if (!spaceId) return error('BAD_REQUEST', 'Space ID required in path', 400);
      return await handleVerifySamples(admin, projectId, spaceId, rbac.auth);
    }

    // Route: PUT .../stage/N
    if (method === 'PUT') {
      const stageNumber = extractStageNumber(url.pathname);
      if (!stageNumber) {
        return error('BAD_REQUEST', 'Stage number required (1-7)', 400);
      }

      const body = await req.json();

      switch (stageNumber) {
        case 1: return await handleStage1(admin, projectId, rbac.auth, body);
        case 2: return await handleStage2(admin, projectId, rbac.auth, body);
        case 3: return await handleStage3(admin, projectId, rbac.auth, body);
        case 4: return await handleStage4(admin, projectId, rbac.auth, body);
        case 5:
          // Stage 5 is handled via the select-template + verify-samples routes above
          return error('USE_DEDICATED_ENDPOINTS',
            'Stage 5 uses POST .../spaces/:space_id/select-template and POST .../spaces/:space_id/verify-samples', 422);
        case 6: return await handleStage6(admin, projectId, rbac.auth, body);
        case 7:
          return error('NOT_IMPLEMENTED', 'Stage 7 requires measurements endpoint (POST .../spaces/:space_id/measurements)', 501);
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

function extractSpaceId(pathname: string): string | null {
  const match = pathname.match(
    /spaces\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  return match ? match[1] : null;
}

function extractStageNumber(pathname: string): number | null {
  const match = pathname.match(/stage\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function extractFurnitureId(pathname: string): string | null {
  const match = pathname.match(
    /furniture\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  return match ? match[1] : null;
}
