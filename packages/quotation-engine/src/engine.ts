/**
 * 13-Step Quotation Engine — Sprint 5 T2
 *
 * Pure function: deterministic computation from assembled inputs.
 * No DB access, no side effects, no randomness.
 *
 * Constants (per spec Part 8):
 *   MARGIN_RATE = 0.25
 *   GST_RATE = 0.18
 *
 * Pricing settings (from pricing_settings table):
 *   LABOUR_DIRECT_PAISE_PER_SQM = 15000  (₹150/sqm)
 *   LABOUR_FRAME_PAISE_PER_SQM = 25000   (₹250/sqm)
 *   TRANSPORT_FLAT_RATE_PAISE = 500000    (₹5,000/project)
 *
 * Rounding: Math.round() at Steps 12 and 13 (AD-30 confirmed).
 * Pricing: unit_cost_paise (AD-29 confirmed). sell_price_paise NOT used.
 */

import {
  QuotationInput,
  QuotationOutput,
  StepBreakdown,
  ConfigLineItem,
  SpaceContext,
} from './types';

const MARGIN_RATE = 0.25;
const GST_RATE = 0.18;

/**
 * Run the 13-step quotation engine.
 *
 * Steps 1-3 are implicit (DNA/panel data/areas already resolved in the input).
 * The engine starts effective computation at Step 4.
 */
export function runQuotationEngine(input: QuotationInput): QuotationOutput {
  const { spaces, line_items, furniture, pricing_settings } = input;

  // ------------------------------------------------------------------
  // Step 4: Panel cost = Σ (quantity × unit_cost_paise) for WALL_PANEL items
  // The CEIL(area/(w×h)) was already done by the config engine (R4).
  // The persisted line_items already have the integer panel quantity.
  // ------------------------------------------------------------------
  const wallPanelItems = line_items.filter(li => li.group_name === 'WALL_PANEL');
  const step_4_wall_panel_total_paise = wallPanelItems.reduce(
    (sum, li) => sum + li.quantity * li.unit_cost_paise,
    0
  );

  // ------------------------------------------------------------------
  // Step 5: Non-panel costs (trims + lighting + consumables)
  // Each line item's cost = quantity × unit_cost_paise
  // ------------------------------------------------------------------
  const trimItems = line_items.filter(li => li.group_name === 'TRIM');
  const lightingItems = line_items.filter(li => li.group_name === 'LIGHTING');
  const consumableItems = line_items.filter(li => li.group_name === 'CONSUMABLE');

  const step_5_trim_total_paise = trimItems.reduce(
    (sum, li) => sum + li.quantity * li.unit_cost_paise,
    0
  );
  const step_5_lighting_total_paise = lightingItems.reduce(
    (sum, li) => sum + li.quantity * li.unit_cost_paise,
    0
  );
  const step_5_consumable_total_paise = consumableItems.reduce(
    (sum, li) => sum + li.quantity * li.unit_cost_paise,
    0
  );
  const step_5_non_panel_total_paise =
    step_5_trim_total_paise + step_5_lighting_total_paise + step_5_consumable_total_paise;

  // ------------------------------------------------------------------
  // Step 6: Structural check — base boards present for all FRAME_BASED spaces
  // A FRAME_BASED space must have a CONSUMABLE line item with
  // generated_by_rule = 'R6' (the structural board from config engine).
  // ------------------------------------------------------------------
  const frameBased = spaces.filter(s => s.installation_type === 'FRAME_BASED');
  const validationErrors: string[] = [];
  let step_6_structural_check: 'PASS' | 'FAIL' = 'PASS';
  let step_6_detail: string | undefined;

  for (const space of frameBased) {
    const hasBoard = line_items.some(
      li => li.space_id === space.space_id && li.generated_by_rule === 'R6'
    );
    if (!hasBoard) {
      step_6_structural_check = 'FAIL';
      step_6_detail = `Space ${space.space_id} (${space.space_type}) is FRAME_BASED but has no structural board (R6)`;
      validationErrors.push(step_6_detail);
    }
  }

  // ------------------------------------------------------------------
  // Step 7: Moisture verify — base board present for every HIGH-moisture space
  // HIGH moisture spaces need either an R6 board or an R7 moisture-backing item.
  // ------------------------------------------------------------------
  let step_7_moisture_check: 'PASS' | 'FAIL' = 'PASS';
  let step_7_detail: string | undefined;

  const highMoistureSpaces = spaces.filter(s => s.moisture_level === 'HIGH');
  for (const space of highMoistureSpaces) {
    const hasBoard = line_items.some(
      li =>
        li.space_id === space.space_id &&
        (li.generated_by_rule === 'R6' || li.sku === 'CSM-PVC-BCK-001')
    );
    if (!hasBoard) {
      step_7_moisture_check = 'FAIL';
      step_7_detail = `Space ${space.space_id} (${space.space_type}) is HIGH moisture but has no moisture backing`;
      validationErrors.push(step_7_detail);
    }
  }

  // ------------------------------------------------------------------
  // Step 8: Labour = Σ (net_area_sqm × LABOUR_RATE[installation_type])
  // net_area_sqm = net_area_sqmm / 1,000,000
  // ------------------------------------------------------------------
  let step_8_labour_total_paise = 0;
  for (const space of spaces) {
    const netAreaSqm = space.net_area_sqmm / 1_000_000;
    const rate =
      space.installation_type === 'FRAME_BASED'
        ? pricing_settings.labour_frame_paise_per_sqm
        : pricing_settings.labour_direct_paise_per_sqm;
    step_8_labour_total_paise += netAreaSqm * rate;
  }

  // ------------------------------------------------------------------
  // Step 9: Transport (flat, once per project)
  // ------------------------------------------------------------------
  const step_9_transport_paise = pricing_settings.transport_flat_rate_paise;

  // ------------------------------------------------------------------
  // Step 10: Furniture = Σ configured_furniture.calculated_cost_paise
  // ------------------------------------------------------------------
  const step_10_furniture_total_paise = furniture.reduce(
    (sum, f) => sum + f.calculated_cost_paise,
    0
  );

  // ------------------------------------------------------------------
  // Step 11: Subtotal = Steps 4 + 5 + 8 + 9 + 10
  // ------------------------------------------------------------------
  const step_11_subtotal_paise =
    step_4_wall_panel_total_paise +
    step_5_non_panel_total_paise +
    step_8_labour_total_paise +
    step_9_transport_paise +
    step_10_furniture_total_paise;

  // ------------------------------------------------------------------
  // Step 12: Margin = ROUND(subtotal × 0.25), pre_gst = subtotal + margin
  // AD-30: Math.round() (half-up, nearest paise)
  // ------------------------------------------------------------------
  const step_12_margin_paise = Math.round(step_11_subtotal_paise * MARGIN_RATE);
  const step_12_pre_gst_total_paise = step_11_subtotal_paise + step_12_margin_paise;

  // ------------------------------------------------------------------
  // Step 13: GST = ROUND(pre_gst × 0.18), grand_total = pre_gst + GST
  // AD-30: Math.round() (half-up, nearest paise)
  // Final grand_total is also rounded to integer paise (BIGINT storage).
  // This is necessary because fractional trim quantities (41.34 rft × 4800)
  // produce non-integer subtotals. The spec's BIGINT column type makes
  // integer storage implicit. The final round is at most ±0.5 paise.
  // ------------------------------------------------------------------
  const step_13_gst_paise = Math.round(step_12_pre_gst_total_paise * GST_RATE);
  const step_13_grand_total_paise = Math.round(step_12_pre_gst_total_paise + step_13_gst_paise);

  // ------------------------------------------------------------------
  // Build output
  // ------------------------------------------------------------------
  const step_breakdown: StepBreakdown = {
    step_4_wall_panel_total_paise,
    step_5_trim_total_paise,
    step_5_lighting_total_paise,
    step_5_consumable_total_paise,
    step_5_non_panel_total_paise,
    step_6_structural_check,
    ...(step_6_detail && { step_6_detail }),
    step_7_moisture_check,
    ...(step_7_detail && { step_7_detail }),
    step_8_labour_total_paise,
    step_9_transport_paise,
    step_10_furniture_total_paise,
    step_11_subtotal_paise,
    step_12_margin_paise,
    step_12_pre_gst_total_paise,
    step_13_gst_paise,
    step_13_grand_total_paise,
  };

  return {
    grand_total_paise: step_13_grand_total_paise,
    step_breakdown,
    validation_passed: validationErrors.length === 0,
    validation_errors: validationErrors,
  };
}
