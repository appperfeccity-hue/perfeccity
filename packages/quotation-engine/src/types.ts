/**
 * Quotation Engine Types — Sprint 5 T2
 *
 * The quotation engine is a PURE FUNCTION: given assembled input data,
 * it produces a deterministic quotation output including the 13-step
 * breakdown and SHA-256 seal.
 *
 * It does NOT query the database — the calling code (RPC or Edge Function)
 * assembles the input from configuration_line_items, application_spaces,
 * pricing_settings, and configured_furniture.
 */

// ============================================================
// Input types (assembled by the caller from DB queries)
// ============================================================

/** One line item from configuration_line_items (persisted by Sprint 4) */
export interface ConfigLineItem {
  space_id: string;
  sku: string;
  product_role: 'PRIMARY' | 'SECONDARY' | 'TRIM' | 'LIGHTING' | 'CONSUMABLE';
  quantity: number;
  unit_label: string;
  unit_cost_paise: number;
  group_name: 'WALL_PANEL' | 'FURNITURE' | 'TRIM' | 'LIGHTING' | 'CONSUMABLE';
  generated_by_rule: string;
}

/** One space's configuration context */
export interface SpaceContext {
  space_id: string;
  space_type: string;
  installation_type: 'DIRECT' | 'FRAME_BASED';
  net_area_sqmm: number;
  moisture_level: 'DRY' | 'MODERATE' | 'HIGH';
}

/** One configured furniture item */
export interface FurnitureItem {
  space_id: string;
  sku: string;
  quantity: number;
  calculated_cost_paise: number;
}

/** Pricing settings from the pricing_settings table */
export interface PricingSettings {
  labour_direct_paise_per_sqm: number;   // default: 15000
  labour_frame_paise_per_sqm: number;    // default: 25000
  transport_flat_rate_paise: number;     // default: 500000
}

/** Full quotation engine input */
export interface QuotationInput {
  project_id: string;
  spaces: SpaceContext[];
  line_items: ConfigLineItem[];
  furniture: FurnitureItem[];
  pricing_settings: PricingSettings;
}

// ============================================================
// Output types
// ============================================================

/** Per-step breakdown (stored in quotation_snapshots.step_breakdown) */
export interface StepBreakdown {
  step_4_wall_panel_total_paise: number;
  step_5_trim_total_paise: number;
  step_5_lighting_total_paise: number;
  step_5_consumable_total_paise: number;
  step_5_non_panel_total_paise: number;
  step_6_structural_check: 'PASS' | 'FAIL';
  step_6_detail?: string;
  step_7_moisture_check: 'PASS' | 'FAIL';
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

/** Full quotation engine output */
export interface QuotationOutput {
  grand_total_paise: number;
  step_breakdown: StepBreakdown;
  validation_passed: boolean;
  validation_errors: string[];
}
