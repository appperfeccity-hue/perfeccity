/**
 * Rule R5 — Trim Auto-Link
 * Source: Part 8, Configuration Engine rules
 * 
 * AD-24 (CONFIRMED): R5 SHALL use the TRIM design element pre-selected by the
 * Designer at template design time. The configuration engine SHALL NOT perform
 * a live search across the product library to discover a trim SKU. The engine
 * SHALL validate that the attached TRIM SKU is ACTIVE and that its declared
 * colour/finish attributes are compatible with the resolved panel attributes
 * before quantity calculation and BOM emission.
 * 
 * Execution order (AD-24):
 * 1. Resolve selected panel SKU (passed in as input)
 * 2. Read template's attached TRIM design_elements (passed in as input)
 * 3. Verify TRIM SKU exists (implied by data being present)
 * 4. Verify TRIM SKU is ACTIVE → else 422 TRIM_SKU_NOT_FOUND
 * 5. Verify colour_variant matches panel → else 422 TRIM_VARIANT_MISMATCH
 * 6. Compute quantity (PER_RFT_PERIMETER)
 * 7. Emit BOM entry
 * 
 * Why NOT runtime search:
 * - The frozen architecture favors predefined products, deterministic configuration,
 *   metadata-first resolution, and immutable published templates
 * - Runtime search would introduce non-deterministic behavior (result depends on
 *   which SKUs exist at the moment of configuration, not at template design time)
 * - Template is the source of truth for allowed trim SKU
 * - Designer's 10-point validation (Check 3) already ensures the SKU is valid at publish
 * 
 * Why runtime VALIDATION despite pre-linking:
 * - A trim SKU could be deactivated between template publish and configuration time
 * - A template could theoretically have a mismatched trim (data-entry error at design time)
 * - "Matching" in Part 8 R5 has semantic meaning: the engine validates the match, it
 *   doesn't discover it, but it DOES confirm it
 */

import { computePerRftPerimeter } from '../formulas/quantity';

export interface TrimElement {
  sku: string;
  colour_variant: string | null;
  finish_variant: string | null;
  default_quantity: number;
  // From product_library (joined)
  sku_status: string;
  sku_is_active: boolean;
  unit_cost_paise: number;
  sell_price_paise: number;
}

export interface TrimInput {
  trim_elements: TrimElement[];
  width_mm: number;
  height_mm: number;
  // The resolved panel's attributes (for compatibility validation — AD-24 step 5)
  panel_colour_variant: string | null;
  panel_finish_variant: string | null;
}

export interface TrimLineItem {
  sku: string;
  product_role: 'TRIM';
  quantity: number;
  unit_label: string;
  unit_cost_paise: number;
  sell_price_paise: number;
  group_name: 'TRIM';
  generated_by_rule: 'R5';
  colour_variant: string | null;
}

/**
 * Compute trim line items from template's TRIM design_elements.
 * AD-24: validates ACTIVE status AND colour/finish compatibility.
 * 
 * @throws TRIM_SKU_NOT_FOUND if any trim element references an inactive/missing SKU
 * @throws TRIM_VARIANT_MISMATCH if trim colour doesn't match resolved panel colour
 */
export function computeTrimLineItems(input: TrimInput): TrimLineItem[] {
  if (input.trim_elements.length === 0) {
    return [];
  }

  // AD-24 steps 4 + 5: verify each trim SKU is active AND compatible
  for (const trim of input.trim_elements) {
    // Step 4: ACTIVE check
    if (!trim.sku_is_active || trim.sku_status !== 'ACTIVE') {
      throw new Error(
        `TRIM_SKU_NOT_FOUND: Trim SKU '${trim.sku}' is not active ` +
        `(status: ${trim.sku_status}). Cannot auto-link inactive trim.`
      );
    }

    // Step 5: Colour/finish compatibility validation (AD-24)
    // "matching panel colour+finish" — validate the pre-linked trim is actually compatible
    if (input.panel_colour_variant && trim.colour_variant) {
      if (trim.colour_variant !== input.panel_colour_variant) {
        throw new Error(
          `TRIM_VARIANT_MISMATCH: Trim SKU '${trim.sku}' has colour_variant='${trim.colour_variant}' ` +
          `but resolved panel has colour_variant='${input.panel_colour_variant}'. ` +
          `Trim must match panel colour per R5 compatibility rule (AD-24).`
        );
      }
    }
    // finish_variant check: only if both are non-null
    if (input.panel_finish_variant && trim.finish_variant) {
      if (trim.finish_variant !== input.panel_finish_variant) {
        throw new Error(
          `TRIM_VARIANT_MISMATCH: Trim SKU '${trim.sku}' has finish_variant='${trim.finish_variant}' ` +
          `but resolved panel has finish_variant='${input.panel_finish_variant}'. ` +
          `Trim must match panel finish per R5 compatibility rule (AD-24).`
        );
      }
    }
  }

  // Step 6: Compute quantity (PER_RFT_PERIMETER)
  const quantity_rft = computePerRftPerimeter(input.width_mm, input.height_mm);

  // Step 7: Emit BOM entries
  return input.trim_elements.map(trim => ({
    sku: trim.sku,
    product_role: 'TRIM' as const,
    quantity: quantity_rft * (trim.default_quantity || 1),
    unit_label: 'rft',
    unit_cost_paise: trim.unit_cost_paise,
    sell_price_paise: trim.sell_price_paise,
    group_name: 'TRIM' as const,
    generated_by_rule: 'R5' as const,
    colour_variant: trim.colour_variant,
  }));
}
