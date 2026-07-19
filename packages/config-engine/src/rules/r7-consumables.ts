/**
 * Rule R7 — Template Consumables with Condition Evaluation
 * Source: Part 8, Configuration Engine rules
 * 
 * Logic:
 * - For each row in template_consumables:
 *   - If condition_field is NULL → always include (unconditional)
 *   - If condition_field is non-NULL → include only if the configuration's
 *     value for that field matches condition_value
 * - Quantity computed by quantity_formula (PER_SQM, FIXED_PER_SPACE, etc.)
 * 
 * Condition fields (valid per Check 9 of 10-point validation):
 * - installation_type, moisture_level, wall_shape, lighting_type, material_preference
 * 
 * SPEC-INTERPRETATION NOTES:
 * - The condition check is equality (condition_value = config_value), not a
 *   pattern/regex — this is how Check 9 validates it ("references a real
 *   Configuration Engine field") and how the seed data uses it
 *   (condition_field='installation_type', condition_value='FRAME_BASED')
 * - No SI item needed: the condition semantics are clear from seed data + Check 9
 */

import { computePerSqm, computeFixedPerSpace, computeFixedPerProject } from '../formulas/quantity';

export interface ConsumableTemplate {
  sku: string;
  quantity_formula: string; // 'PER_SQM' | 'FIXED_PER_SPACE' | 'FIXED_PER_PROJECT' | 'PER_RFT_PERIMETER' | 'PER_RFT_HEIGHT'
  condition_field: string | null;
  condition_value: string | null;
}

export interface ConfigurationState {
  installation_type: string;
  moisture_level: string;
  wall_shape: string;
  lighting_type: string;
  material_preference: string;
  net_area_sqmm: number;
  width_mm: number;
  height_mm: number;
}

export interface ConsumableLineItem {
  sku: string;
  product_role: 'CONSUMABLE';
  quantity: number;
  unit_label: string;
  group_name: 'CONSUMABLE';
  generated_by_rule: 'R7';
}

/**
 * Evaluate whether a consumable template should be included based on its condition.
 * Returns true if the consumable should be added to the configuration.
 */
export function evaluateCondition(
  consumable: ConsumableTemplate,
  config: ConfigurationState
): boolean {
  // No condition = always include
  if (!consumable.condition_field || !consumable.condition_value) {
    return true;
  }

  // Look up the config value for the condition field
  const configValue = (config as Record<string, unknown>)[consumable.condition_field];

  if (configValue === undefined || configValue === null) {
    // Field doesn't exist in config state — condition fails
    return false;
  }

  // Equality check (not pattern/regex)
  return String(configValue) === consumable.condition_value;
}

/**
 * Compute quantity for a consumable based on its quantity_formula.
 * 
 * NOTE: PER_RFT_HEIGHT is implemented but its correctness depends on SI-2
 * (whether divisor is /1000 or /304.8). Currently uses /1000 (spec literal).
 * Test for this case is tagged [SI-2 BLOCKED].
 */
export function computeConsumableQuantity(
  formula: string,
  config: ConfigurationState
): { quantity: number; unit_label: string } {
  switch (formula) {
    case 'PER_SQM':
      return { quantity: computePerSqm(config.net_area_sqmm), unit_label: 'sqm' };

    case 'FIXED_PER_SPACE':
      return { quantity: computeFixedPerSpace(), unit_label: 'unit' };

    case 'FIXED_PER_PROJECT':
      return { quantity: computeFixedPerProject(), unit_label: 'unit' };

    case 'PER_RFT_PERIMETER': {
      // 2(width+height)/304.8
      const perimeterRft = 2 * (config.width_mm + config.height_mm) / 304.8;
      return { quantity: perimeterRft, unit_label: 'rft' };
    }

    case 'PER_RFT_HEIGHT': {
      // SI-2 PENDING: spec says /1000, name implies /304.8
      // Currently: /1000 (spec literal). May change after SI-2 confirmation.
      const heightQty = config.height_mm / 1000;
      return { quantity: heightQty, unit_label: 'rft' };
    }

    default:
      throw new Error(`R7: Unknown quantity_formula: ${formula}`);
  }
}

/**
 * Process all template consumables and produce line items for those
 * whose conditions match the current configuration state.
 */
export function computeConsumableLineItems(
  consumables: ConsumableTemplate[],
  config: ConfigurationState
): ConsumableLineItem[] {
  const results: ConsumableLineItem[] = [];

  for (const consumable of consumables) {
    // Evaluate condition
    if (!evaluateCondition(consumable, config)) {
      continue; // Condition not met — skip this consumable
    }

    // Compute quantity
    const { quantity, unit_label } = computeConsumableQuantity(
      consumable.quantity_formula,
      config
    );

    results.push({
      sku: consumable.sku,
      product_role: 'CONSUMABLE',
      quantity,
      unit_label,
      group_name: 'CONSUMABLE',
      generated_by_rule: 'R7',
    });
  }

  return results;
}
