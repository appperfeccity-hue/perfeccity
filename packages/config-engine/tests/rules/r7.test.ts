/**
 * Rule R7 Tests — Template Consumables with Condition Evaluation
 * 
 * Tests condition evaluation logic and quantity formula dispatch.
 * All formula-derived except one [SI-2 BLOCKED] test for PER_RFT_HEIGHT.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateCondition,
  computeConsumableQuantity,
  computeConsumableLineItems,
  ConsumableTemplate,
  ConfigurationState,
} from '../../src/rules/r7-consumables';

const baseConfig: ConfigurationState = {
  installation_type: 'FRAME_BASED',
  moisture_level: 'DRY',
  wall_shape: 'STRAIGHT',
  lighting_type: 'COVE_LIGHT',
  material_preference: 'WPC',
  net_area_sqmm: 9720000,
  width_mm: 3600,
  height_mm: 2700,
};

describe('R7: evaluateCondition', () => {
  it('null condition_field → always true (unconditional)', () => {
    const consumable: ConsumableTemplate = {
      sku: 'CSM-ADH-PNL-001',
      quantity_formula: 'PER_SQM',
      condition_field: null,
      condition_value: null,
    };
    expect(evaluateCondition(consumable, baseConfig)).toBe(true);
  });

  it('condition matches → true', () => {
    const consumable: ConsumableTemplate = {
      sku: 'CSM-PVC-BSB-001',
      quantity_formula: 'PER_SQM',
      condition_field: 'installation_type',
      condition_value: 'FRAME_BASED',
    };
    expect(evaluateCondition(consumable, baseConfig)).toBe(true);
  });

  it('condition does not match → false', () => {
    const consumable: ConsumableTemplate = {
      sku: 'CSM-PVC-BSB-001',
      quantity_formula: 'PER_SQM',
      condition_field: 'installation_type',
      condition_value: 'DIRECT',
    };
    expect(evaluateCondition(consumable, baseConfig)).toBe(false);
  });

  it('moisture_level=HIGH condition on DRY config → false', () => {
    const consumable: ConsumableTemplate = {
      sku: 'CSM-PVC-BCK-001',
      quantity_formula: 'PER_SQM',
      condition_field: 'moisture_level',
      condition_value: 'HIGH',
    };
    expect(evaluateCondition(consumable, baseConfig)).toBe(false);
  });

  it('moisture_level=HIGH condition on HIGH config → true', () => {
    const consumable: ConsumableTemplate = {
      sku: 'CSM-PVC-BCK-001',
      quantity_formula: 'PER_SQM',
      condition_field: 'moisture_level',
      condition_value: 'HIGH',
    };
    const highConfig = { ...baseConfig, moisture_level: 'HIGH' };
    expect(evaluateCondition(consumable, highConfig)).toBe(true);
  });

  it('unknown condition_field → false (field not in config)', () => {
    const consumable: ConsumableTemplate = {
      sku: 'CSM-X',
      quantity_formula: 'PER_SQM',
      condition_field: 'nonexistent_field',
      condition_value: 'anything',
    };
    expect(evaluateCondition(consumable, baseConfig)).toBe(false);
  });

  // Full coverage matrix for ALL 5 valid condition fields (required before T8 freeze)
  describe('Full condition field coverage (all 5 valid fields)', () => {
    it('wall_shape match → true', () => {
      const consumable: ConsumableTemplate = {
        sku: 'CSM-X', quantity_formula: 'PER_SQM',
        condition_field: 'wall_shape', condition_value: 'STRAIGHT',
      };
      expect(evaluateCondition(consumable, baseConfig)).toBe(true);
    });

    it('wall_shape no-match → false', () => {
      const consumable: ConsumableTemplate = {
        sku: 'CSM-X', quantity_formula: 'PER_SQM',
        condition_field: 'wall_shape', condition_value: 'L_SHAPE',
      };
      expect(evaluateCondition(consumable, baseConfig)).toBe(false);
    });

    it('lighting_type match → true', () => {
      const consumable: ConsumableTemplate = {
        sku: 'CSM-X', quantity_formula: 'PER_SQM',
        condition_field: 'lighting_type', condition_value: 'COVE_LIGHT',
      };
      expect(evaluateCondition(consumable, baseConfig)).toBe(true);
    });

    it('lighting_type no-match → false', () => {
      const consumable: ConsumableTemplate = {
        sku: 'CSM-X', quantity_formula: 'PER_SQM',
        condition_field: 'lighting_type', condition_value: 'NONE',
      };
      expect(evaluateCondition(consumable, baseConfig)).toBe(false);
    });

    it('material_preference match → true', () => {
      const consumable: ConsumableTemplate = {
        sku: 'CSM-X', quantity_formula: 'PER_SQM',
        condition_field: 'material_preference', condition_value: 'WPC',
      };
      expect(evaluateCondition(consumable, baseConfig)).toBe(true);
    });

    it('material_preference no-match → false', () => {
      const consumable: ConsumableTemplate = {
        sku: 'CSM-X', quantity_formula: 'PER_SQM',
        condition_field: 'material_preference', condition_value: 'PVC',
      };
      expect(evaluateCondition(consumable, baseConfig)).toBe(false);
    });
  });
});

describe('R7: computeConsumableQuantity', () => {
  it('PER_SQM on 9,720,000 sqmm → 9.72', () => {
    // Formula-derived: 9720000/1000000 = 9.72
    const { quantity, unit_label } = computeConsumableQuantity('PER_SQM', baseConfig);
    expect(quantity).toBeCloseTo(9.72);
    expect(unit_label).toBe('sqm');
  });

  it('FIXED_PER_SPACE → 1', () => {
    const { quantity, unit_label } = computeConsumableQuantity('FIXED_PER_SPACE', baseConfig);
    expect(quantity).toBe(1);
    expect(unit_label).toBe('unit');
  });

  it('FIXED_PER_PROJECT → 1', () => {
    const { quantity, unit_label } = computeConsumableQuantity('FIXED_PER_PROJECT', baseConfig);
    expect(quantity).toBe(1);
    expect(unit_label).toBe('unit');
  });

  it('PER_RFT_PERIMETER on 3600×2700 → 41.34 rft', () => {
    // Formula-derived: 2(3600+2700)/304.8 = 12600/304.8 = 41.3386...
    const { quantity, unit_label } = computeConsumableQuantity('PER_RFT_PERIMETER', baseConfig);
    expect(quantity).toBeCloseTo(41.34, 1);
    expect(unit_label).toBe('rft');
  });

  it('[SI-2 CONFIRMED] PER_RFT_HEIGHT on 2700mm → 2.7 (spec literal /1000, AD-23)', () => {
    // SPEC-INTERPRETATION [SI-2]: CONFIRMED.
    // /1000 is the frozen specification value. Any change to /304.8 requires
    // a formal spec revision. The naming inconsistency ("RFT" but /1000) is
    // acknowledged — the formula produces what the spec states, not what the
    // name might imply.
    const { quantity, unit_label } = computeConsumableQuantity('PER_RFT_HEIGHT', baseConfig);
    expect(quantity).toBeCloseTo(2.7);
    expect(unit_label).toBe('rft');
  });

  it('unknown formula → throws', () => {
    expect(() => computeConsumableQuantity('UNKNOWN', baseConfig)).toThrow('R7: Unknown quantity_formula');
  });
});

describe('R7: computeConsumableLineItems (integration)', () => {
  it('regression fixture: Nordic Shadow template consumables on FRAME_BASED/DRY config', () => {
    // Seed data for Nordic Shadow (template b000...001):
    // - CSM-PVC-BSB-001 PER_SQM condition: installation_type=FRAME_BASED → INCLUDE
    // - CSM-ADH-PNL-001 PER_SQM condition: null → INCLUDE (unconditional)
    // - CSM-PVC-BCK-001 PER_SQM condition: moisture_level=HIGH → EXCLUDE (DRY)
    const consumables: ConsumableTemplate[] = [
      { sku: 'CSM-PVC-BSB-001', quantity_formula: 'PER_SQM', condition_field: 'installation_type', condition_value: 'FRAME_BASED' },
      { sku: 'CSM-ADH-PNL-001', quantity_formula: 'PER_SQM', condition_field: null, condition_value: null },
      { sku: 'CSM-PVC-BCK-001', quantity_formula: 'PER_SQM', condition_field: 'moisture_level', condition_value: 'HIGH' },
    ];

    const results = computeConsumableLineItems(consumables, baseConfig);

    // 2 of 3 should be included (moisture backing excluded — DRY config)
    expect(results).toHaveLength(2);
    expect(results[0].sku).toBe('CSM-PVC-BSB-001');
    expect(results[0].quantity).toBeCloseTo(9.72);
    expect(results[1].sku).toBe('CSM-ADH-PNL-001');
    expect(results[1].quantity).toBeCloseTo(9.72);
    // CSM-PVC-BCK-001 excluded (moisture_level=HIGH ≠ DRY)
  });

  it('regression fixture: same template on HIGH moisture → all 3 included', () => {
    const consumables: ConsumableTemplate[] = [
      { sku: 'CSM-PVC-BSB-001', quantity_formula: 'PER_SQM', condition_field: 'installation_type', condition_value: 'FRAME_BASED' },
      { sku: 'CSM-ADH-PNL-001', quantity_formula: 'PER_SQM', condition_field: null, condition_value: null },
      { sku: 'CSM-PVC-BCK-001', quantity_formula: 'PER_SQM', condition_field: 'moisture_level', condition_value: 'HIGH' },
    ];

    const highConfig = { ...baseConfig, moisture_level: 'HIGH' };
    const results = computeConsumableLineItems(consumables, highConfig);

    // All 3 included (FRAME_BASED ✓, unconditional ✓, HIGH ✓)
    expect(results).toHaveLength(3);
    expect(results[2].sku).toBe('CSM-PVC-BCK-001');
  });

  it('DIRECT installation → base board excluded', () => {
    const consumables: ConsumableTemplate[] = [
      { sku: 'CSM-PVC-BSB-001', quantity_formula: 'PER_SQM', condition_field: 'installation_type', condition_value: 'FRAME_BASED' },
      { sku: 'CSM-ADH-PNL-001', quantity_formula: 'PER_SQM', condition_field: null, condition_value: null },
    ];

    const directConfig = { ...baseConfig, installation_type: 'DIRECT' };
    const results = computeConsumableLineItems(consumables, directConfig);

    // Only unconditional adhesive included
    expect(results).toHaveLength(1);
    expect(results[0].sku).toBe('CSM-ADH-PNL-001');
  });

  it('all line items have correct generated_by_rule', () => {
    const consumables: ConsumableTemplate[] = [
      { sku: 'CSM-ADH-PNL-001', quantity_formula: 'PER_SQM', condition_field: null, condition_value: null },
    ];

    const results = computeConsumableLineItems(consumables, baseConfig);
    expect(results[0].generated_by_rule).toBe('R7');
    expect(results[0].group_name).toBe('CONSUMABLE');
    expect(results[0].product_role).toBe('CONSUMABLE');
  });
});
