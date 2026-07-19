/**
 * Configuration Engine Orchestrator — runs R1–R8 in sequence
 * 
 * Source: Part 8, Configuration Engine rules
 * 
 * Execution order (deterministic):
 * R1: Determine installation type from lighting
 * R2: Determine base board thickness from lighting
 * R3: Add moisture base board thickness (stacks with R2)
 * R4: Compute panel quantity (CEIL formula, PRIMARY line item)
 * R5: Auto-link trim (validate + compute quantity)
 * R6: Add structural board if needed (based on R2+R3 thickness)
 * R7: Add consumables from template (evaluate conditions)
 * R8: Compute configuration_hash (SHA-256 of canonical JSON)
 * 
 * R9 (archive old config, insert new) is a DB operation handled by the
 * calling endpoint, not by this pure-computation orchestrator.
 * 
 * Pre-run guard: effective material_preference must be in
 * template.compatible_materials else 422 TEMPLATE_MATERIAL_MISMATCH
 */

import { computeArea, WallShape } from '../formulas/area';
import { determineInstallationType, LightingType } from './r1-installation-type';
import { determineBaseBoardThickness } from './r2-base-board';
import { computeTotalBaseBoardThickness, MoistureLevel } from './r3-moisture';
import { computePanelLineItem, PanelLineItem } from './r4-panel-quantity';
import { computeTrimLineItems, TrimElement, TrimLineItem } from './r5-trim-auto-link';
import { computeStructuralBoardLineItem, StructuralBoardLineItem } from './r6-structural-board';
import { computeConsumableLineItems, ConsumableTemplate, ConsumableLineItem, ConfigurationState } from './r7-consumables';
import { computeConfigurationHash, ConfigHashInput } from './r8-configuration-hash';

export interface EngineInput {
  // Space measurements
  wall_shape: WallShape;
  width_mm: number;
  height_mm: number;
  segment_b_mm?: number | null;
  segment_c_mm?: number | null;
  opening_deduction_sqmm?: number | null;

  // Template data
  template_id: string;
  lighting_type: LightingType;
  moisture_level: MoistureLevel;
  material_preference: string;
  compatible_materials: string[];

  // Panel SKU (PRIMARY element from template)
  panel_sku: string;
  panel_width_mm: number;
  panel_height_mm: number;
  panel_unit_cost_paise: number;
  panel_sell_price_paise: number;
  panel_colour_variant: string | null;
  panel_finish_variant: string | null;

  // Trim elements (from template design_elements where product_role=TRIM)
  trim_elements: TrimElement[];

  // Structural board SKU (for R6)
  board_sku: string;
  board_unit_cost_paise: number;
  board_sell_price_paise: number;

  // Template consumables (for R7)
  template_consumables: ConsumableTemplate[];

  // Furniture (from configured_furniture for this space/config)
  furniture: Array<{
    sku: string;
    quantity: number;
    default_position: string | null;
    colour_variant: string | null;
  }>;
}

export interface EngineOutput {
  // R1 output
  installation_type: string;
  // R2+R3 output
  back_board_mm: number;
  // Area computation
  gross_area_sqmm: number;
  net_area_sqmm: number;
  // All line items produced by the engine
  line_items: Array<PanelLineItem | TrimLineItem | StructuralBoardLineItem | ConsumableLineItem>;
  // R8 output
  configuration_hash: string;
}

/**
 * Run the Configuration Engine (R1–R8) for one space.
 * Returns all computed line items + the configuration_hash.
 * 
 * @throws TEMPLATE_MATERIAL_MISMATCH if material_preference not in compatible_materials
 * @throws INVALID_NET_AREA if opening deduction exceeds gross area
 * @throws TRIM_SKU_NOT_FOUND if a trim element references an inactive SKU
 * @throws TRIM_VARIANT_MISMATCH if trim colour/finish doesn't match panel (AD-24)
 */
export async function runConfigurationEngine(input: EngineInput): Promise<EngineOutput> {
  // Pre-run guard: material compatibility
  if (!input.compatible_materials.includes(input.material_preference)) {
    throw new Error(
      `TEMPLATE_MATERIAL_MISMATCH: material_preference '${input.material_preference}' ` +
      `is not in template's compatible_materials: [${input.compatible_materials.join(', ')}]`
    );
  }

  // R1: Installation type
  const installation_type = determineInstallationType(input.lighting_type);

  // R2: Base board thickness
  const r2Thickness = determineBaseBoardThickness(input.lighting_type);

  // R3: Moisture addition (stacks with R2)
  const back_board_mm = computeTotalBaseBoardThickness(r2Thickness, input.moisture_level);

  // Area computation (shared by R4 and R6)
  const area = computeArea({
    wall_shape: input.wall_shape,
    width_mm: input.width_mm,
    height_mm: input.height_mm,
    segment_b_mm: input.segment_b_mm,
    segment_c_mm: input.segment_c_mm,
    opening_deduction_sqmm: input.opening_deduction_sqmm,
  });

  // R4: Panel quantity
  const panelLineItem = computePanelLineItem({
    wall_shape: input.wall_shape,
    width_mm: input.width_mm,
    height_mm: input.height_mm,
    segment_b_mm: input.segment_b_mm,
    segment_c_mm: input.segment_c_mm,
    opening_deduction_sqmm: input.opening_deduction_sqmm,
    panel_sku: input.panel_sku,
    panel_width_mm: input.panel_width_mm,
    panel_height_mm: input.panel_height_mm,
    panel_unit_cost_paise: input.panel_unit_cost_paise,
    panel_sell_price_paise: input.panel_sell_price_paise,
  });

  // R5: Trim auto-link (with AD-24 colour/finish validation)
  const trimLineItems = computeTrimLineItems({
    trim_elements: input.trim_elements,
    width_mm: input.width_mm,
    height_mm: input.height_mm,
    panel_colour_variant: input.panel_colour_variant,
    panel_finish_variant: input.panel_finish_variant,
  });

  // R6: Structural board (conditional on R2+R3 thickness > 0)
  const structuralBoard = computeStructuralBoardLineItem({
    total_board_thickness_mm: back_board_mm,
    net_area_sqmm: area.net_area_sqmm,
    board_sku: input.board_sku,
    board_unit_cost_paise: input.board_unit_cost_paise,
    board_sell_price_paise: input.board_sell_price_paise,
  });

  // R7: Template consumables (condition evaluation)
  const configState: ConfigurationState = {
    installation_type,
    moisture_level: input.moisture_level,
    wall_shape: input.wall_shape,
    lighting_type: input.lighting_type,
    material_preference: input.material_preference,
    net_area_sqmm: area.net_area_sqmm,
    width_mm: input.width_mm,
    height_mm: input.height_mm,
  };
  const consumableLineItems = computeConsumableLineItems(input.template_consumables, configState);

  // Collect all line items
  const allLineItems: EngineOutput['line_items'] = [
    panelLineItem,
    ...trimLineItems,
    ...(structuralBoard ? [structuralBoard] : []),
    ...consumableLineItems,
  ];

  // R8: Configuration hash
  const hashInput: ConfigHashInput = {
    template_id: input.template_id,
    measurements: {
      width_mm: input.width_mm,
      height_mm: input.height_mm,
      segment_b_mm: input.segment_b_mm,
      segment_c_mm: input.segment_c_mm,
      opening_deduction_sqmm: input.opening_deduction_sqmm ?? null,
      gross_area_sqmm: area.gross_area_sqmm,
      net_area_sqmm: area.net_area_sqmm,
    },
    line_items: allLineItems.map(li => ({
      sku: li.sku,
      quantity: li.quantity,
      unit_label: li.unit_label,
      product_role: li.product_role,
      group_name: li.group_name,
    })),
    furniture: input.furniture,
  };

  const configuration_hash = await computeConfigurationHash(hashInput);

  return {
    installation_type,
    back_board_mm,
    gross_area_sqmm: area.gross_area_sqmm,
    net_area_sqmm: area.net_area_sqmm,
    line_items: allLineItems,
    configuration_hash,
  };
}
