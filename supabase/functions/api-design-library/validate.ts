/**
 * 10-Point Smart Validation — Sprint 3 T6
 * 
 * POST /api/v1/design-library/:id/validate
 * Role: DESIGNER (own templates), ADMIN
 * Repeatable any time from DRAFT.
 * 
 * Returns per-check PASS/FAIL with itemized reasons (not just aggregate).
 * Each check is a separate function for independent testability.
 * 
 * Pre-write checklist (T6):
 * - No multi-step writes (read-only operation — queries and returns results)
 * - No DELETE operations
 * - No RPC needed (pure read + computation)
 * - Service-role query: needed to check product_library status for all SKUs
 *   (Designer's RLS allows reading product_library, so actually user-client
 *   would work here — but using admin for consistency with other handlers)
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { success, error } from '../_shared/response.ts';

interface ValidationResult {
  check_number: number;
  check_name: string;
  passed: boolean;
  reason?: string;
}

/**
 * Runs all 10 validation checks against a template.
 * Returns the full report regardless of pass/fail — caller decides what to do.
 */
export async function runValidation(
  admin: SupabaseClient,
  templateId: string
): Promise<ValidationResult[]> {
  // Fetch template and all related data in parallel
  const [templateResult, elementsResult, consumablesResult, assetsResult] = await Promise.all([
    admin.from('design_templates').select('*').eq('template_id', templateId).single(),
    admin.from('design_elements').select('*, product_library(sku, status, is_active, category, furniture_category)').eq('template_id', templateId),
    admin.from('template_consumables').select('*').eq('template_id', templateId),
    admin.from('digital_assets').select('*').eq('template_id', templateId),
  ]);

  const template = templateResult.data;
  const elements = elementsResult.data || [];
  const consumables = consumablesResult.data || [];
  const assets = assetsResult.data || [];

  if (!template) {
    return [{ check_number: 0, check_name: 'Template Exists', passed: false, reason: 'Template not found' }];
  }

  const results: ValidationResult[] = [];

  // Check 1: Template Information
  results.push(check1_templateInfo(template));

  // Check 2: GLB Assets
  results.push(check2_glbAssets(assets));

  // Check 3: Product Compatibility
  results.push(check3_productCompatibility(elements));

  // Check 4: Furniture Compatibility
  results.push(check4_furnitureCompatibility(elements));

  // Check 5: Inventory Availability
  results.push(check5_inventoryAvailability(elements));

  // Check 6: Production Rules
  results.push(check6_productionRules(template));

  // Check 7: Installation Rules
  results.push(check7_installationRules(template, elements));

  // Check 8: Dynamic BOM Readiness
  results.push(check8_bomReadiness(elements));

  // Check 9: Quotation Readiness
  results.push(check9_quotationReadiness(consumables));

  // Check 10: Publication Readiness (meta-check: 1–9 pass + compatible arrays non-empty)
  results.push(check10_publicationReadiness(results, template));

  return results;
}

// ============================================================
// Individual checks (each independently testable)
// ============================================================

function check1_templateInfo(template: Record<string, unknown>): ValidationResult {
  const required = ['template_name', 'space_type', 'theme', 'price_range', 'template_type'];
  const missing = required.filter(f => !template[f]);
  return {
    check_number: 1,
    check_name: 'Template Information',
    passed: missing.length === 0,
    ...(missing.length > 0 && { reason: `Missing required fields: ${missing.join(', ')}` }),
  };
}

function check2_glbAssets(assets: Record<string, unknown>[]): ValidationResult {
  const activeGlb = assets.filter(a => a.asset_type === 'GLB' && a.is_active === true);
  const thumbnail = assets.filter(a => a.asset_type === 'RENDER' && a.is_active === true);

  const issues: string[] = [];
  if (activeGlb.length === 0) issues.push('No active GLB asset uploaded');
  if (thumbnail.length === 0) issues.push('No thumbnail image uploaded');

  return {
    check_number: 2,
    check_name: 'GLB Assets',
    passed: issues.length === 0,
    ...(issues.length > 0 && { reason: issues.join('; ') }),
  };
}

function check3_productCompatibility(elements: Record<string, unknown>[]): ValidationResult {
  const inactive = elements.filter(e => {
    const product = e.product_library as Record<string, unknown> | null;
    return product && product.status !== 'ACTIVE';
  });

  return {
    check_number: 3,
    check_name: 'Product Compatibility',
    passed: inactive.length === 0,
    ...(inactive.length > 0 && {
      reason: `${inactive.length} element(s) reference inactive SKUs: ${inactive.map(e => e.sku).join(', ')}`,
    }),
  };
}

function check4_furnitureCompatibility(elements: Record<string, unknown>[]): ValidationResult {
  const furnitureElements = elements.filter(e => {
    const product = e.product_library as Record<string, unknown> | null;
    return product && product.category === 'FURNITURE';
  });

  const issues: string[] = [];

  // Max 1 TV_CONSOLE
  const tvConsoles = furnitureElements.filter(e => {
    const product = e.product_library as Record<string, unknown>;
    return product.furniture_category === 'TV_CONSOLE';
  });
  if (tvConsoles.length > 1) {
    issues.push(`${tvConsoles.length} TV Console items (max 1 allowed)`);
  }

  // No duplicate default_position (unless CUSTOM)
  const positions = furnitureElements
    .map(e => e.default_position as string)
    .filter(p => p && p !== 'CUSTOM');
  const duplicatePositions = positions.filter((p, i) => positions.indexOf(p) !== i);
  if (duplicatePositions.length > 0) {
    issues.push(`Duplicate positions without CUSTOM override: ${[...new Set(duplicatePositions)].join(', ')}`);
  }

  return {
    check_number: 4,
    check_name: 'Furniture Compatibility',
    passed: issues.length === 0,
    ...(issues.length > 0 && { reason: issues.join('; ') }),
  };
}

function check5_inventoryAvailability(elements: Record<string, unknown>[]): ValidationResult {
  const unavailable = elements.filter(e => {
    const product = e.product_library as Record<string, unknown> | null;
    return product && product.is_active !== true;
  });

  return {
    check_number: 5,
    check_name: 'Inventory Availability',
    passed: unavailable.length === 0,
    ...(unavailable.length > 0 && {
      reason: `${unavailable.length} SKU(s) not currently active: ${unavailable.map(e => e.sku).join(', ')}`,
    }),
  };
}

function check6_productionRules(template: Record<string, unknown>): ValidationResult {
  const issues: string[] = [];

  const minW = template.min_width_mm as number | null;
  const maxW = template.max_width_mm as number | null;
  const minH = template.min_height_mm as number | null;
  const maxH = template.max_height_mm as number | null;

  if (minW == null || maxW == null) issues.push('min_width_mm and max_width_mm must be set');
  if (minH == null || maxH == null) issues.push('min_height_mm and max_height_mm must be set');
  if (minW != null && maxW != null && minW >= maxW) issues.push(`min_width_mm (${minW}) must be less than max_width_mm (${maxW})`);
  if (minH != null && maxH != null && minH >= maxH) issues.push(`min_height_mm (${minH}) must be less than max_height_mm (${maxH})`);

  return {
    check_number: 6,
    check_name: 'Production Rules',
    passed: issues.length === 0,
    ...(issues.length > 0 && { reason: issues.join('; ') }),
  };
}

function check7_installationRules(template: Record<string, unknown>, elements: Record<string, unknown>[]): ValidationResult {
  const installationType = template.installation_type as string | null;
  const lightingElements = elements.filter(e => (e.product_role as string) === 'LIGHTING');

  // R1: COVE_LIGHT/PROFILE_LIGHT requires FRAME_BASED
  // Check if any lighting element exists and installation_type is DIRECT
  if (lightingElements.length > 0 && installationType === 'DIRECT') {
    return {
      check_number: 7,
      check_name: 'Installation Rules',
      passed: false,
      reason: 'Lighting elements (COVE_LIGHT/PROFILE_LIGHT) require FRAME_BASED installation, but template has DIRECT',
    };
  }

  if (!installationType) {
    return {
      check_number: 7,
      check_name: 'Installation Rules',
      passed: false,
      reason: 'installation_type must be set',
    };
  }

  return { check_number: 7, check_name: 'Installation Rules', passed: true };
}

function check8_bomReadiness(elements: Record<string, unknown>[]): ValidationResult {
  const primaryElements = elements.filter(e => (e.product_role as string) === 'PRIMARY');

  return {
    check_number: 8,
    check_name: 'Dynamic BOM Readiness',
    passed: primaryElements.length >= 1,
    ...(primaryElements.length === 0 && {
      reason: 'At least one element with product_role=PRIMARY is required (wall panel)',
    }),
  };
}

function check9_quotationReadiness(consumables: Record<string, unknown>[]): ValidationResult {
  // Valid condition_fields that the Configuration Engine actually uses
  const validConditionFields = [
    'installation_type', 'moisture_level', 'wall_shape',
    'lighting_type', 'material_preference', null, // null = unconditional
  ];

  const invalid = consumables.filter(c => {
    const field = c.condition_field as string | null;
    return field !== null && !validConditionFields.includes(field);
  });

  return {
    check_number: 9,
    check_name: 'Quotation Readiness',
    passed: invalid.length === 0,
    ...(invalid.length > 0 && {
      reason: `${invalid.length} consumable(s) reference unknown condition_field: ${invalid.map(c => c.condition_field).join(', ')}`,
    }),
  };
}

function check10_publicationReadiness(
  previousResults: ValidationResult[],
  template: Record<string, unknown>
): ValidationResult {
  const issues: string[] = [];

  // All previous checks must pass
  const failedChecks = previousResults.filter(r => !r.passed);
  if (failedChecks.length > 0) {
    issues.push(`${failedChecks.length} check(s) failed: ${failedChecks.map(r => `#${r.check_number}`).join(', ')}`);
  }

  // compatible_spaces must be non-empty
  const spaces = template.compatible_spaces as string[] | null;
  if (!spaces || spaces.length === 0) {
    issues.push('compatible_spaces must have at least one value');
  }

  // compatible_materials must be non-empty
  const materials = template.compatible_materials as string[] | null;
  if (!materials || materials.length === 0) {
    issues.push('compatible_materials must have at least one value');
  }

  return {
    check_number: 10,
    check_name: 'Publication Readiness',
    passed: issues.length === 0,
    ...(issues.length > 0 && { reason: issues.join('; ') }),
  };
}

export { ValidationResult };
