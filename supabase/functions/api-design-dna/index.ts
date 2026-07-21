/**
 * Edge Function: api-design-dna
 * PUT /api/v1/projects/:id/design-dna
 * Role: owning Consultant only
 * 
 * Sprint 2 T7 — Design DNA (project-level preferences)
 * 
 * UPSERT into design_dna (1:1 with project).
 * Not stage-gated — can be filled at any point during consultation.
 * Used by the Recommendation Engine (Sprint 4).
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireAuth } from '../_shared/middleware/rbac.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { success, error } from '../_shared/response.ts';

const VALID_DESIGN_STYLES = ['MODERN', 'CONTEMPORARY', 'MINIMAL', 'LUXURY', 'SCANDINAVIAN', 'INDUSTRIAL', 'CLASSIC'];
const VALID_COLOUR_PALETTES = ['WHITE', 'GREY', 'BEIGE', 'BLACK', 'WALNUT', 'OAK', 'MARBLE', 'CUSTOM'];
const VALID_MATERIALS = ['PVC', 'WPC', 'BAMBOO_CHARCOAL', 'UV_MARBLE'];
const VALID_FINISHES = ['MATTE', 'GLOSS', 'TEXTURED', 'WOOD_GRAIN', 'STONE_FINISH'];
const VALID_LIGHTING = ['WARM_WHITE', 'NEUTRAL_WHITE', 'COOL_WHITE', 'COVE_LIGHTING', 'LINEAR_LED', 'NO_LIGHTING'];

serve(async (req: Request) => {
  if (req.method !== 'PUT') {
    return error('METHOD_NOT_ALLOWED', 'Only PUT is accepted', 405);
  }

  const rbac = await requireAuth(req, ['ADMIN', 'SALESPERSON']);
  if (!rbac.ok) return rbac.response;

  try {
    const url = new URL(req.url);
    const projectId = extractProjectId(url.pathname);
    if (!projectId) {
      return error('BAD_REQUEST', 'Project ID required in path', 400);
    }

    const admin = getAdminClient();

    // Ownership check
    const { data: project } = await admin
      .from('projects')
      .select('consultant_id')
      .eq('project_id', projectId)
      .single();

    if (!project) return error('PROJECT_NOT_FOUND', 'Project not found', 404);
    if (rbac.auth.role === 'SALESPERSON' && project.consultant_id !== rbac.auth.userId) {
      return error('LEAD_NOT_ASSIGNED_TO_YOU', 'You are not the assigned consultant', 403);
    }

    const body = await req.json();

    // Validate enum values if provided
    if (body.design_style && !VALID_DESIGN_STYLES.includes(body.design_style)) {
      return error('VALIDATION_ERROR', `design_style must be one of: ${VALID_DESIGN_STYLES.join(', ')}`, 422, 'design_style');
    }
    if (body.colour_palette && !VALID_COLOUR_PALETTES.includes(body.colour_palette)) {
      return error('VALIDATION_ERROR', `colour_palette must be one of: ${VALID_COLOUR_PALETTES.join(', ')}`, 422, 'colour_palette');
    }
    if (body.material_preference && !VALID_MATERIALS.includes(body.material_preference)) {
      return error('VALIDATION_ERROR', `material_preference must be one of: ${VALID_MATERIALS.join(', ')}`, 422, 'material_preference');
    }
    if (body.finish_preference && !VALID_FINISHES.includes(body.finish_preference)) {
      return error('VALIDATION_ERROR', `finish_preference must be one of: ${VALID_FINISHES.join(', ')}`, 422, 'finish_preference');
    }
    if (body.lighting_preference && !VALID_LIGHTING.includes(body.lighting_preference)) {
      return error('VALIDATION_ERROR', `lighting_preference must be one of: ${VALID_LIGHTING.join(', ')}`, 422, 'lighting_preference');
    }

    // UPSERT
    const { data: existing } = await admin
      .from('design_dna')
      .select('dna_id')
      .eq('project_id', projectId)
      .single();

    const payload = {
      project_id: projectId,
      design_style: body.design_style || null,
      colour_palette: body.colour_palette || null,
      material_preference: body.material_preference || null,
      finish_preference: body.finish_preference || null,
      lighting_preference: body.lighting_preference || null,
      updated_at: new Date().toISOString(),
    };

    let result;
    if (existing) {
      const { data, error: e } = await admin.from('design_dna').update(payload).eq('project_id', projectId).select().single();
      if (e) return error('DB_ERROR', 'Failed to update design DNA', 500);
      result = data;
    } else {
      const { data, error: e } = await admin.from('design_dna').insert(payload).select().single();
      if (e) return error('DB_ERROR', 'Failed to save design DNA', 500);
      result = data;
    }

    return success({ design_dna: result });
  } catch (e) {
    console.error('api-design-dna error:', e);
    return error('INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
});

function extractProjectId(pathname: string): string | null {
  const match = pathname.match(/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[1] : null;
}
