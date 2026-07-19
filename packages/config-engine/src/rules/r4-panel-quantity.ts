/**
 * Rule R4 — Panel Quantity Calculation
 * Source: Part 8, Configuration Engine rules
 * 
 * Logic:
 * - For each space, compute net_area_sqmm (from area formulas)
 * - Look up the PRIMARY wall panel SKU's width_mm and height_mm from product_library
 * - PER_PANEL = CEIL(net_area_sqmm / (width_mm × height_mm))
 * - Produces configuration_line_items rows for wall panels
 * 
 * v7.0: width_mm/height_mm are literal numeric columns on product_library
 * (not parsed from a dimensions string). This rule NEVER reads the `dimensions`
 * display field — it reads width_mm and height_mm directly.
 * 
 * Dependencies:
 * - computePanelQuantity from formulas/quantity.ts (T2, already tested)
 * - computeArea from formulas/area.ts (T1, already tested)
 * 
 * No spec-interpretation needed: the formula is frozen arithmetic.
 * The only potential SI would be "what if width_mm or height_mm is NULL on the
 * product_library row?" — but this is caught by the pre-run guard
 * (WALL_PANEL category requires non-null dimensions per R2b validation).
 */

import { computeArea, WallShape, AreaInput } from '../formulas/area';
import { computePanelQuantity } from '../formulas/quantity';

export interface PanelInput {
  // Space measurements
  wall_shape: WallShape;
  width_mm: number;
  height_mm: number;
  segment_b_mm?: number | null;
  segment_c_mm?: number | null;
  opening_deduction_sqmm?: number | null;

  // Panel SKU data (from product_library — the PRIMARY element's SKU)
  panel_sku: string;
  panel_width_mm: number;   // product_library.width_mm (v7.0 numeric source)
  panel_height_mm: number;  // product_library.height_mm (v7.0 numeric source)
  panel_unit_cost_paise: number;
  panel_sell_price_paise: number;
}

export interface PanelLineItem {
  sku: string;
  product_role: 'PRIMARY';
  quantity: number;
  unit_label: string;
  unit_cost_paise: number;
  sell_price_paise: number;
  group_name: 'WALL_PANEL';
  generated_by_rule: 'R4';
  // Intermediate values (for debugging/verification)
  _gross_area_sqmm: number;
  _net_area_sqmm: number;
  _panel_area_sqmm: number;
}

/**
 * Compute panel quantity and produce a line item.
 * This is R4's core logic — everything else is just data assembly.
 * 
 * @throws INVALID_NET_AREA if opening_deduction >= gross_area
 * @throws INVALID_PANEL_DIMENSIONS if panel width/height are 0 or negative
 */
export function computePanelLineItem(input: PanelInput): PanelLineItem {
  // Validate panel dimensions exist (should be caught by SKU validation,
  // but defense-in-depth here since this directly affects pricing)
  if (!input.panel_width_mm || input.panel_width_mm <= 0) {
    throw new Error(
      `R4: Panel SKU '${input.panel_sku}' has invalid width_mm (${input.panel_width_mm}). ` +
      'WALL_PANEL SKUs must have non-null positive width_mm in product_library.'
    );
  }
  if (!input.panel_height_mm || input.panel_height_mm <= 0) {
    throw new Error(
      `R4: Panel SKU '${input.panel_sku}' has invalid height_mm (${input.panel_height_mm}). ` +
      'WALL_PANEL SKUs must have non-null positive height_mm in product_library.'
    );
  }

  // Compute area using the shared formula (T1)
  const area = computeArea({
    wall_shape: input.wall_shape,
    width_mm: input.width_mm,
    height_mm: input.height_mm,
    segment_b_mm: input.segment_b_mm,
    segment_c_mm: input.segment_c_mm,
    opening_deduction_sqmm: input.opening_deduction_sqmm,
  });

  // Compute panel count using CEIL formula (T2)
  const quantity = computePanelQuantity(
    area.net_area_sqmm,
    input.panel_width_mm,
    input.panel_height_mm
  );

  return {
    sku: input.panel_sku,
    product_role: 'PRIMARY',
    quantity,
    unit_label: 'pc',
    unit_cost_paise: input.panel_unit_cost_paise,
    sell_price_paise: input.panel_sell_price_paise,
    group_name: 'WALL_PANEL',
    generated_by_rule: 'R4',
    _gross_area_sqmm: area.gross_area_sqmm,
    _net_area_sqmm: area.net_area_sqmm,
    _panel_area_sqmm: input.panel_width_mm * input.panel_height_mm,
  };
}
