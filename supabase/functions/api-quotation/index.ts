/**
 * Edge Function: api-quotation
 * Sprint 5 T8 — Quotation Generation Endpoint
 *
 * POST /api/v1/projects/:id/quotation
 * Role: owning Consultant (SALESPERSON) or ADMIN
 * Prerequisite: project.status = REVIEWED (Review Gate must have passed)
 *
 * Orchestration flow:
 * 1. Validate project status = REVIEWED
 * 2. Gather all current configurations + line items + spaces + furniture
 * 3. Read pricing_settings
 * 4. Run 13-step quotation engine (pure computation)
 * 5. Compute quotation seal (SHA-256 of canonical payload)
 * 6. Persist atomically via persist_quotation_snapshot RPC
 * 7. Transition project status REVIEWED → QUOTED
 * 8. Return sealed quotation summary
 *
 * Pre-write checklist applied:
 * - Multi-step write: persistence is atomic via RPC (migration 00015) ✅
 * - State machine: only REVIEWED → QUOTED ✅
 * - Response envelope: {data, errors} ✅
 * - Error codes distinct ✅
 * - No forbidden keys in customer-facing response ✅
 *
 * ⚠️ CO-MAINTENANCE: RAISE EXCEPTION patterns in migrations 00015/00016
 *   are matched here for error code extraction.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireAuth } from '../_shared/middleware/rbac.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { success, error } from '../_shared/response.ts';

// ============================================================
// Constants (from spec Part 8, pricing_settings table)
// ============================================================
const MARGIN_RATE = 0.25;
const GST_RATE = 0.18;
const ENGINE_VERSION = '1.0.0';

serve(async (req: Request) => {
  const url = new URL(req.url);
  const method = req.method;

  const rbac = await requireAuth(req, ['ADMIN', 'SALESPERSON', 'MANAGER']);
  if (!rbac.ok) return rbac.response;

  try {
    const admin = getAdminClient();
    const projectId = extractProjectId(url.pathname);

    if (!projectId) {
      return error('BAD_REQUEST', 'Project ID required in path (/api/v1/projects/:id/quotation)', 400);
    }

    // GET .../bom-export — CSV download
    if (method === 'GET' && url.pathname.includes('/bom-export')) {
      const { handleBomExport } = await import('./bom-export.ts');
      return await handleBomExport(admin, projectId);
    }

    // GET .../pdf — Quotation PDF
    if (method === 'GET' && url.pathname.includes('/pdf')) {
      const { handleQuotationPdf } = await import('./pdf.ts');
      return await handleQuotationPdf(admin, projectId);
    }

    if (method !== 'POST') {
      return error('METHOD_NOT_ALLOWED', 'Use POST for generation, GET for bom-export/pdf', 405);
    }

    // -------------------------------------------------------
    // Step 1: Validate project exists and status = REVIEWED
    // -------------------------------------------------------
    const { data: project, error: projErr } = await admin
      .from('projects')
      .select('project_id, consultant_id, status')
      .eq('project_id', projectId)
      .single();

    if (projErr || !project) {
      return error('PROJECT_NOT_FOUND', 'No project found with the specified ID', 404);
    }

    // Ownership check for Consultants
    if (rbac.auth.role === 'SALESPERSON' && project.consultant_id !== rbac.auth.userId) {
      return error('LEAD_NOT_ASSIGNED_TO_YOU', 'You are not the assigned consultant for this project', 403);
    }

    if (project.status !== 'REVIEWED') {
      return error('INVALID_STATUS',
        `Project must be in REVIEWED status to generate quotation (current: ${project.status}). ` +
        'Submit for review first via POST /api/v1/projects/:id/review', 422);
      // ⚠️ CO-MAINTENANCE: status guard mirrors T1's review gate guard pattern
    }

    // -------------------------------------------------------
    // Step 2: Gather all spaces + current configs + line items
    // -------------------------------------------------------
    const { data: spaces } = await admin
      .from('application_spaces')
      .select('space_id, space_type, net_area_sqmm')
      .eq('project_id', projectId);

    if (!spaces || spaces.length === 0) {
      return error('NO_SPACES', 'Project has no application spaces', 422);
    }

    // Get current configurations for each space (installation_type needed for labour calc)
    const spaceIds = spaces.map(s => s.space_id);
    const { data: configs } = await admin
      .from('space_configurations')
      .select('space_id, installation_type')
      .eq('project_id', projectId)
      .eq('is_current', true)
      .in('space_id', spaceIds);

    // Get site assessment for moisture levels
    const { data: siteAssessment } = await admin
      .from('site_assessments')
      .select('moisture_level')
      .eq('project_id', projectId)
      .single();

    const moistureLevel = siteAssessment?.moisture_level || 'DRY';

    // Build space contexts
    const spaceContexts = spaces.map(s => {
      const cfg = configs?.find(c => c.space_id === s.space_id);
      return {
        space_id: s.space_id,
        space_type: s.space_type,
        installation_type: cfg?.installation_type || 'DIRECT',
        net_area_sqmm: s.net_area_sqmm || 0,
        moisture_level: moistureLevel,
      };
    });

    // Get all line items from current configurations
    const { data: lineItems } = await admin
      .from('configuration_line_items')
      .select('space_id, sku, product_role, quantity, unit_label, unit_cost_paise, group_name, generated_by_rule')
      .eq('project_id', projectId)
      .in('space_id', spaceIds);

    if (!lineItems || lineItems.length === 0) {
      return error('NO_LINE_ITEMS', 'No configuration line items found for current configs', 422);
    }

    // Get configured furniture
    const { data: furniture } = await admin
      .from('configured_furniture')
      .select('space_id, sku, quantity, calculated_cost_paise')
      .eq('project_id', projectId)
      .in('space_id', spaceIds);

    // -------------------------------------------------------
    // Step 3: Read pricing_settings
    // -------------------------------------------------------
    const { data: pricingRows } = await admin
      .from('pricing_settings')
      .select('key, value_paise');

    const pricingMap: Record<string, number> = {};
    for (const row of pricingRows || []) {
      pricingMap[row.key] = row.value_paise;
    }

    const pricingSettings = {
      labour_direct_paise_per_sqm: pricingMap['LABOUR_DIRECT_PAISE_PER_SQM'] || 15000,
      labour_frame_paise_per_sqm: pricingMap['LABOUR_FRAME_PAISE_PER_SQM'] || 25000,
      transport_flat_rate_paise: pricingMap['TRANSPORT_FLAT_RATE_PAISE'] || 500000,
    };

    // -------------------------------------------------------
    // Step 4: Run 13-step quotation engine (pure computation)
    // -------------------------------------------------------
    const engineResult = runQuotationEngine({
      spaces: spaceContexts,
      line_items: lineItems,
      furniture: furniture || [],
      pricing_settings: pricingSettings,
    });

    // Check validation (Steps 6 + 7)
    if (!engineResult.validation_passed) {
      return error('QUOTATION_VALIDATION_FAILED',
        `Quotation engine validation failed: ${engineResult.validation_errors.join('; ')}`, 422);
    }

    // -------------------------------------------------------
    // Step 5: Compute quotation seal
    // -------------------------------------------------------
    const generatedAt = new Date().toISOString();
    const snapshotId = crypto.randomUUID();

    const sealPayloadObj = {
      generated_at: generatedAt,
      grand_total_paise: engineResult.grand_total_paise,
      project_id: projectId,
      snapshot_id: snapshotId,
      step_breakdown: engineResult.step_breakdown,
      version: ENGINE_VERSION,
    };

    const sealPayloadCanonical = canonicalizeSeal(sealPayloadObj);
    const sealHash = await computeSha256(sealPayloadCanonical);

    // -------------------------------------------------------
    // Step 6: Persist atomically via RPC
    // -------------------------------------------------------
    const bomLines = lineItems.map(li => ({
      space_id: li.space_id,
      furniture_id: null,
      sku: li.sku,
      source: li.group_name,
      component_label: li.sku, // Use SKU as label for now
      quantity: li.quantity,
      unit_label: li.unit_label,
      unit_cost_paise: li.unit_cost_paise,
      line_total_paise: Math.round(li.quantity * li.unit_cost_paise),
    }));

    // Add furniture as bom_lines
    for (const f of furniture || []) {
      bomLines.push({
        space_id: f.space_id,
        furniture_id: null, // Would need furniture_id from configured_furniture
        sku: f.sku,
        source: 'FURNITURE',
        component_label: f.sku,
        quantity: f.quantity,
        unit_label: 'unit',
        unit_cost_paise: Math.round(f.calculated_cost_paise / f.quantity),
        line_total_paise: f.calculated_cost_paise,
      });
    }

    const { data: rpcResult, error: rpcError } = await admin.rpc('persist_quotation_snapshot', {
      p_project_id: projectId,
      p_grand_total_paise: engineResult.grand_total_paise,
      p_step_breakdown: engineResult.step_breakdown,
      p_sha256_hash: sealHash,
      p_seal_payload: sealPayloadObj,
      p_generated_by: rbac.auth.userId,
      p_bom_lines: bomLines,
    });

    if (rpcError) {
      const msg = rpcError.message || '';
      // ⚠️ CO-MAINTENANCE: matched by supabase/migrations/00015
      if (msg.includes('PROJECT_NOT_FOUND')) {
        return error('PROJECT_NOT_FOUND', 'Project not found during persistence', 404);
      }
      if (msg.includes('INVALID_SEAL_HASH')) {
        return error('SEAL_COMPUTATION_ERROR', 'Internal error: seal hash format invalid', 500);
      }
      if (msg.includes('EMPTY_BOM_LINES')) {
        return error('INTERNAL_ERROR', 'Internal error: no BOM lines produced', 500);
      }
      console.error('persist_quotation_snapshot RPC error:', rpcError);
      return error('PERSISTENCE_ERROR', 'Failed to persist quotation snapshot', 500);
    }

    // -------------------------------------------------------
    // Step 7: Status transition (REVIEWED → QUOTED) is now handled
    // INSIDE persist_quotation_snapshot RPC (migration 00020).
    // The RPC atomically transitions status + writes state_history.
    // No separate transition needed here — prevents audit trail gaps.
    // -------------------------------------------------------

    // -------------------------------------------------------
    // Step 8: Return sealed quotation summary
    // -------------------------------------------------------
    const result = rpcResult as {
      snapshot_id: string;
      sealed_at: string;
      expires_at: string;
      bom_line_count: number;
      sha256_hash: string;
    };

    return success({
      snapshot_id: result.snapshot_id,
      grand_total_paise: engineResult.grand_total_paise,
      grand_total_rupees: (engineResult.grand_total_paise / 100).toFixed(2),
      sealed_at: result.sealed_at,
      expires_at: result.expires_at,
      sha256_hash: result.sha256_hash,
      bom_line_count: result.bom_line_count,
      step_breakdown: engineResult.step_breakdown,
      message: 'Quotation generated and sealed successfully',
    }, 201);
  } catch (e) {
    console.error('api-quotation error:', e);
    return error('INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
});

// ============================================================
// Pure computation (inlined from quotation-engine for Edge Function)
// Same logic as packages/quotation-engine/src/engine.ts
// ============================================================

interface SpaceCtx {
  space_id: string;
  space_type: string;
  installation_type: string;
  net_area_sqmm: number;
  moisture_level: string;
}

interface LineItem {
  space_id: string;
  sku: string;
  product_role: string;
  quantity: number;
  unit_label: string;
  unit_cost_paise: number;
  group_name: string;
  generated_by_rule: string;
}

interface FurnitureItem {
  space_id: string;
  sku: string;
  quantity: number;
  calculated_cost_paise: number;
}

interface PricingSettings {
  labour_direct_paise_per_sqm: number;
  labour_frame_paise_per_sqm: number;
  transport_flat_rate_paise: number;
}

interface EngineInput {
  spaces: SpaceCtx[];
  line_items: LineItem[];
  furniture: FurnitureItem[];
  pricing_settings: PricingSettings;
}

interface StepBreakdown {
  step_4_wall_panel_total_paise: number;
  step_5_trim_total_paise: number;
  step_5_lighting_total_paise: number;
  step_5_consumable_total_paise: number;
  step_5_non_panel_total_paise: number;
  step_6_structural_check: string;
  step_6_detail?: string;
  step_7_moisture_check: string;
  step_7_detail?: string;
  step_8_labour_total_paise: number;
  step_9_transport_paise: number;
  step_10_furniture_total_paise: number;
  step_11_subtotal_paise: number;
  step_12_margin_paise: number;
  step_12_pre_gst_total_paise: number;
  step_13_gst_paise: number;
  step_13_grand_total_paise: number;
}

interface EngineOutput {
  grand_total_paise: number;
  step_breakdown: StepBreakdown;
  validation_passed: boolean;
  validation_errors: string[];
}

function runQuotationEngine(input: EngineInput): EngineOutput {
  const { spaces, line_items, furniture, pricing_settings } = input;

  // Step 4: Panel cost (AD-31: per-line Math.round)
  const wallPanelItems = line_items.filter(li => li.group_name === 'WALL_PANEL');
  const step_4 = wallPanelItems.reduce((sum, li) => sum + Math.round(li.quantity * li.unit_cost_paise), 0);

  // Step 5: Non-panel costs
  const trimItems = line_items.filter(li => li.group_name === 'TRIM');
  const lightingItems = line_items.filter(li => li.group_name === 'LIGHTING');
  const consumableItems = line_items.filter(li => li.group_name === 'CONSUMABLE');

  const step_5_trim = trimItems.reduce((sum, li) => sum + Math.round(li.quantity * li.unit_cost_paise), 0);
  const step_5_lighting = lightingItems.reduce((sum, li) => sum + Math.round(li.quantity * li.unit_cost_paise), 0);
  const step_5_consumable = consumableItems.reduce((sum, li) => sum + Math.round(li.quantity * li.unit_cost_paise), 0);
  const step_5_non_panel = step_5_trim + step_5_lighting + step_5_consumable;

  // Step 6: Structural check
  const validationErrors: string[] = [];
  let step_6_check: 'PASS' | 'FAIL' = 'PASS';
  let step_6_detail: string | undefined;
  for (const space of spaces.filter(s => s.installation_type === 'FRAME_BASED')) {
    if (!line_items.some(li => li.space_id === space.space_id && li.generated_by_rule === 'R6')) {
      step_6_check = 'FAIL';
      step_6_detail = `Space ${space.space_id} (${space.space_type}) is FRAME_BASED but has no structural board (R6)`;
      validationErrors.push(step_6_detail);
    }
  }

  // Step 7: Moisture check
  let step_7_check: 'PASS' | 'FAIL' = 'PASS';
  let step_7_detail: string | undefined;
  for (const space of spaces.filter(s => s.moisture_level === 'HIGH')) {
    if (!line_items.some(li => li.space_id === space.space_id && (li.generated_by_rule === 'R6' || li.sku === 'CSM-PVC-BCK-001'))) {
      step_7_check = 'FAIL';
      step_7_detail = `Space ${space.space_id} (${space.space_type}) is HIGH moisture but has no moisture backing`;
      validationErrors.push(step_7_detail);
    }
  }

  // Step 8: Labour (AD-31: per-space Math.round)
  let step_8 = 0;
  for (const space of spaces) {
    const sqm = space.net_area_sqmm / 1_000_000;
    const rate = space.installation_type === 'FRAME_BASED'
      ? pricing_settings.labour_frame_paise_per_sqm
      : pricing_settings.labour_direct_paise_per_sqm;
    step_8 += Math.round(sqm * rate);
  }

  // Step 9: Transport
  const step_9 = pricing_settings.transport_flat_rate_paise;

  // Step 10: Furniture
  const step_10 = furniture.reduce((sum, f) => sum + f.calculated_cost_paise, 0);

  // Step 11: Subtotal
  const step_11 = step_4 + step_5_non_panel + step_8 + step_9 + step_10;

  // Step 12: Margin (AD-30)
  const step_12_margin = Math.round(step_11 * MARGIN_RATE);
  const step_12_pre_gst = step_11 + step_12_margin;

  // Step 13: GST (AD-30)
  const step_13_gst = Math.round(step_12_pre_gst * GST_RATE);
  const step_13_grand_total = step_12_pre_gst + step_13_gst;

  const step_breakdown: StepBreakdown = {
    step_4_wall_panel_total_paise: step_4,
    step_5_trim_total_paise: step_5_trim,
    step_5_lighting_total_paise: step_5_lighting,
    step_5_consumable_total_paise: step_5_consumable,
    step_5_non_panel_total_paise: step_5_non_panel,
    step_6_structural_check: step_6_check,
    ...(step_6_detail && { step_6_detail }),
    step_7_moisture_check: step_7_check,
    ...(step_7_detail && { step_7_detail }),
    step_8_labour_total_paise: step_8,
    step_9_transport_paise: step_9,
    step_10_furniture_total_paise: step_10,
    step_11_subtotal_paise: step_11,
    step_12_margin_paise: step_12_margin,
    step_12_pre_gst_total_paise: step_12_pre_gst,
    step_13_gst_paise: step_13_gst,
    step_13_grand_total_paise: step_13_grand_total,
  };

  return {
    grand_total_paise: step_13_grand_total,
    step_breakdown,
    validation_passed: validationErrors.length === 0,
    validation_errors: validationErrors,
  };
}

// ============================================================
// Seal computation (inlined from packages/quotation-engine/src/seal.ts)
// SEPARATE implementation from config-engine (Part 8 explicit)
// ============================================================

function canonicalizeSeal(obj: unknown): string {
  if (obj === null || obj === undefined) return '';
  if (typeof obj === 'number' || typeof obj === 'boolean') return JSON.stringify(obj);
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalizeSeal).join(',') + ']';
  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    const pairs: string[] = [];
    for (const key of keys) {
      const value = (obj as Record<string, unknown>)[key];
      if (value === null || value === undefined) continue;
      pairs.push(JSON.stringify(key) + ':' + canonicalizeSeal(value));
    }
    return '{' + pairs.join(',') + '}';
  }
  return JSON.stringify(obj);
}

async function computeSha256(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function extractProjectId(pathname: string): string | null {
  const match = pathname.match(
    /projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  return match ? match[1] : null;
}
