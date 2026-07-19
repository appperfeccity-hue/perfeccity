/**
 * Rule R5 — Trim Auto-Link
 * Source: Part 8, Configuration Engine rules
 * 
 * Logic:
 * - Read TRIM elements from the template's design_elements
 * - Verify each TRIM SKU is still ACTIVE in product_library
 * - If ANY trim SKU is not found/not active → throw TRIM_SKU_NOT_FOUND (422)
 * - Compute quantity using PER_RFT_PERIMETER (trims run along wall perimeter)
 * - Produce configuration_line_items rows for each trim
 * 
 * INTERPRETATION NOTE (NOT an SI item — clear from seed data):
 * R5 says "auto-link TRIM SKUs matching panel colour+finish." This does NOT mean
 * a fuzzy search across all product_library trims. The template's design_elements
 * already contains the specific TRIM SKU selected by the Designer (with matching
 * colour_variant). R5's job is to:
 * 1. Take the template's TRIM elements (pre-selected at design time)
 * 2. Verify they're still ACTIVE
 * 3. Compute their quantity
 * 
 * Evidence: all 3 seed templates have explicit TRIM design_elements with
 * colour_variant matching their PRIMARY panel's colour_variant.
 * The "matching" in the spec refers to the Designer's selection responsibility
 * (enforced by Check 3/5 of the 10-point validation), not a runtime search.
 */

import { computePerRftPerimeter } from '../formulas/quantity';

export interface TrimElement {
  sku: string;
  colour_variant: string | null;
  finish_variant: string | null;
  default_quantity: number;
  // From product_library (joined)
  sku_status: string; // 'ACTIVE' | 'INACTIVE' | etc.
  sku_is_active: boolean;
  unit_cost_paise: number;
  sell_price_paise: number;
}

export interface TrimInput {
  trim_elements: TrimElement[];
  width_mm: number;
  height_mm: number;
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
 * 
 * @throws TRIM_SKU_NOT_FOUND if any trim element references an inactive/missing SKU
 */
export function computeTrimLineItems(input: TrimInput): TrimLineItem[] {
  if (input.trim_elements.length === 0) {
    // No trim elements on this template — valid (some templates may not have trim)
    return [];
  }

  // Verify all trim SKUs are active
  for (const trim of input.trim_elements) {
    if (!trim.sku_is_active || trim.sku_status !== 'ACTIVE') {
      throw new Error(
        `TRIM_SKU_NOT_FOUND: Trim SKU '${trim.sku}' is not active ` +
        `(status: ${trim.sku_status}). Cannot auto-link inactive trim.`
      );
    }
  }

  // Compute quantity: PER_RFT_PERIMETER for trims
  // Trims run along the wall perimeter: 2(width + height) / 304.8
  const quantity_rft = computePerRftPerimeter(input.width_mm, input.height_mm);

  // Produce line items
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
