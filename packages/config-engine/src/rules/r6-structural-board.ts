/**
 * Rule R6 — Structural Board Addition
 * Source: Part 8, Configuration Engine rules
 * 
 * Logic:
 * - If R2/R3 determined a base board is needed (total thickness > 0mm):
 *   → add matching CONSUMABLE base board SKU
 * - Quantity: PER_SQM (net_area converted to sqm)
 * - Only fires when installation_type = FRAME_BASED (which is guaranteed
 *   when board thickness > 0, since R1 sets FRAME_BASED for any lighting)
 * 
 * Uses computePerSqm from formulas/quantity.ts (T2, already tested).
 * No spec-interpretation needed: conditional addition with PER_SQM quantity.
 */

import { computePerSqm } from '../formulas/quantity';

export interface StructuralBoardInput {
  total_board_thickness_mm: number;  // from R2+R3 (computeTotalBaseBoardThickness)
  net_area_sqmm: number;
  // The matching consumable SKU (looked up by thickness from product_library)
  board_sku: string;
  board_unit_cost_paise: number;
  board_sell_price_paise: number;
}

export interface StructuralBoardLineItem {
  sku: string;
  product_role: 'CONSUMABLE';
  quantity: number;  // in sqm (area-based)
  unit_label: string;
  unit_cost_paise: number;
  sell_price_paise: number;
  group_name: 'CONSUMABLE';
  generated_by_rule: 'R6';
}

/**
 * Determine if a structural board is needed and compute its line item.
 * Returns null if no board is needed (thickness = 0).
 * 
 * Part 8 R6: "Structural board required (R2/R3) → add matching CONSUMABLE base board SKU"
 */
export function computeStructuralBoardLineItem(
  input: StructuralBoardInput
): StructuralBoardLineItem | null {
  // No board needed if thickness is 0 (R2=NONE + R3=DRY/AMBIENT)
  if (input.total_board_thickness_mm <= 0) {
    return null;
  }

  // Compute quantity in sqm (PER_SQM formula)
  const quantity_sqm = computePerSqm(input.net_area_sqmm);

  return {
    sku: input.board_sku,
    product_role: 'CONSUMABLE',
    quantity: quantity_sqm,
    unit_label: 'sqm',
    unit_cost_paise: input.board_unit_cost_paise,
    sell_price_paise: input.board_sell_price_paise,
    group_name: 'CONSUMABLE',
    generated_by_rule: 'R6',
  };
}
