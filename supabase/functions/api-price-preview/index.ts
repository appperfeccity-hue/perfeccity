/**
 * Edge Function: api-price-preview
 * Sprint 6 T10 — Price Preview (AD-33)
 *
 * GET /api/v1/projects/:id/price-preview
 * Role: owning SALESPERSON or ADMIN
 *
 * Returns: Σ(sell_price_paise × quantity) per space from current configurations.
 * Uses sell_price_paise directly (AD-33 confirmed by Akshay).
 * Does NOT run the formal quotation engine.
 *
 * Purpose: quick approximate display for Consultant mid-conversation.
 * NOT the authoritative customer-facing price (that's the sealed quotation).
 * Will differ from the sealed total because:
 * - Sealed quotation uses unit_cost_paise + 25% margin (AD-29)
 * - Preview uses sell_price_paise (Admin-set per-SKU, non-uniform markup)
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireAuth } from '../_shared/middleware/rbac.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { success, error } from '../_shared/response.ts';

serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method !== 'GET') {
    return error('METHOD_NOT_ALLOWED', 'Only GET is allowed', 405);
  }

  // RBAC: owning SALESPERSON or ADMIN
  const rbac = await requireAuth(req, ['ADMIN', 'SALESPERSON']);
  if (!rbac.ok) return rbac.response;

  try {
    const admin = getAdminClient();
    const projectId = extractProjectId(url.pathname);

    if (!projectId) {
      return error('BAD_REQUEST', 'Project ID required in path', 400);
    }

    // Ownership check for SALESPERSON
    if (rbac.auth.role === 'SALESPERSON') {
      const { data: project } = await admin
        .from('projects')
        .select('consultant_id')
        .eq('project_id', projectId)
        .single();

      if (!project) {
        return error('PROJECT_NOT_FOUND', 'No project found', 404);
      }
      if (project.consultant_id !== rbac.auth.userId) {
        return error('LEAD_NOT_ASSIGNED_TO_YOU', 'You are not the assigned consultant', 403);
      }
    }

    // Get all current configuration line items with sell_price_paise
    const { data: lineItems } = await admin
      .from('configuration_line_items')
      .select('space_id, sku, quantity, sell_price_paise, group_name')
      .eq('project_id', projectId)
      .in('config_id', admin
        .from('space_configurations')
        .select('config_id')
        .eq('project_id', projectId)
        .eq('is_current', true)
      );

    if (!lineItems || lineItems.length === 0) {
      return success({
        project_id: projectId,
        preview_total_paise: 0,
        preview_total_rupees: '0.00',
        spaces: [],
        note: 'No current configurations found. Complete Stage 7 first.',
      });
    }

    // Compute Σ(sell_price_paise × quantity) per space (AD-33: per-line Math.round)
    const spaceMap: Record<string, { items: Array<{ sku: string; quantity: number; line_total: number; group: string }>; total: number }> = {};

    for (const li of lineItems) {
      const spaceId = li.space_id;
      if (!spaceMap[spaceId]) {
        spaceMap[spaceId] = { items: [], total: 0 };
      }
      const lineTotal = Math.round(li.quantity * li.sell_price_paise);
      spaceMap[spaceId].items.push({
        sku: li.sku,
        quantity: li.quantity,
        line_total: lineTotal,
        group: li.group_name,
      });
      spaceMap[spaceId].total += lineTotal;
    }

    const spaces = Object.entries(spaceMap).map(([spaceId, data]) => ({
      space_id: spaceId,
      total_paise: data.total,
      total_rupees: (data.total / 100).toFixed(2),
      item_count: data.items.length,
    }));

    const grandTotal = spaces.reduce((sum, s) => sum + s.total_paise, 0);

    return success({
      project_id: projectId,
      preview_total_paise: grandTotal,
      preview_total_rupees: (grandTotal / 100).toFixed(2),
      spaces,
      note: 'This is an approximate preview using sell_price_paise. The formal quotation (sealed) uses unit_cost_paise + margin and may differ.',
    });
  } catch (e) {
    console.error('api-price-preview error:', e);
    return error('INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
});

function extractProjectId(pathname: string): string | null {
  const match = pathname.match(
    /projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  return match ? match[1] : null;
}
