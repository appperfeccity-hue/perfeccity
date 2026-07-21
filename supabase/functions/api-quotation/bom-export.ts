/**
 * BOM Export — CSV download of bill of materials for a project
 *
 * GET /api/v1/projects/:id/quotation/bom-export
 * Role: ADMIN, MANAGER, owning SALESPERSON
 *
 * Returns CSV with all bom_lines for the latest sealed snapshot.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { error } from '../_shared/response.ts';

export async function handleBomExport(
  admin: SupabaseClient,
  projectId: string
): Promise<Response> {
  // Get latest sealed snapshot
  const { data: project } = await admin
    .from('projects')
    .select('latest_snapshot_id')
    .eq('project_id', projectId)
    .single();

  if (!project || !project.latest_snapshot_id) {
    return error('NO_QUOTATION', 'No sealed quotation found for BOM export', 404);
  }

  // Get BOM lines
  const { data: bomLines, error: queryErr } = await admin
    .from('bom_lines')
    .select('sku, source, component_label, quantity, unit_label, unit_cost_paise, line_total_paise')
    .eq('snapshot_id', project.latest_snapshot_id)
    .order('source', { ascending: true });

  if (queryErr) return error('DB_ERROR', 'Failed to export BOM', 500);
  if (!bomLines || bomLines.length === 0) {
    return error('EMPTY_BOM', 'BOM has no line items', 404);
  }

  // Build CSV
  const headers = ['sku', 'source', 'component_label', 'quantity', 'unit_label', 'unit_cost_paise', 'line_total_paise'];
  const rows = bomLines.map(line =>
    headers.map(h => {
      const val = (line as Record<string, unknown>)[h];
      if (val === null || val === undefined) return '';
      const str = String(val);
      return str.includes(',') ? `"${str}"` : str;
    }).join(',')
  );

  const csv = [headers.join(','), ...rows].join('\n');

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="bom-${projectId}.csv"`,
    },
  });
}
