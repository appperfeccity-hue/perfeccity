/**
 * Integration Test — 3-Space Regression Fixture (Part 8 / Part 10 Gate 1)
 * 
 * ACTUALLY EXECUTED. Full R1–R8 pipeline.
 * This is where configuration_hash gets FROZEN.
 * 
 * Fixture spaces (from Part 8):
 * 1. TV_UNIT_WALL 3600×2700 STRAIGHT / WPC Oak / COVE_LIGHT / PREMIUM
 * 2. BED_BACK_WALL 3000×2700 STRAIGHT / WPC Oak / NONE / PREMIUM
 * 3. BATHROOM_WALL 2400×2700 STRAIGHT / PVC White / NONE / STANDARD / moisture=HIGH
 */

import { describe, it, expect } from 'vitest';
import { runConfigurationEngine, EngineInput } from '../../src/rules/index';

// Shared seed data (from Part 11)
const OAK_TRIM = {
  sku: 'TRM-OAK-SGP-001',
  colour_variant: 'Oak',
  finish_variant: null,
  default_quantity: 1,
  sku_status: 'ACTIVE',
  sku_is_active: true,
  unit_cost_paise: 4800,
  sell_price_paise: 6240,
};

const WHITE_TRIM = {
  sku: 'TRM-WHT-SGP-001',
  colour_variant: 'White',
  finish_variant: null,
  default_quantity: 1,
  sku_status: 'ACTIVE',
  sku_is_active: true,
  unit_cost_paise: 4500,
  sell_price_paise: 5850,
};

const BASE_BOARD = {
  board_sku: 'CSM-PVC-BSB-001',
  board_unit_cost_paise: 8500,
  board_sell_price_paise: 11050,
};

// Template consumables (Nordic Shadow pattern)
const FRAME_BASED_CONSUMABLES = [
  { sku: 'CSM-PVC-BSB-001', quantity_formula: 'PER_SQM', condition_field: 'installation_type', condition_value: 'FRAME_BASED' },
  { sku: 'CSM-ADH-PNL-001', quantity_formula: 'PER_SQM', condition_field: null, condition_value: null },
  { sku: 'CSM-PVC-BCK-001', quantity_formula: 'PER_SQM', condition_field: 'moisture_level', condition_value: 'HIGH' },
];

// Template consumables for NONE lighting (no frame-based condition match)
const DIRECT_CONSUMABLES = [
  { sku: 'CSM-PVC-BSB-001', quantity_formula: 'PER_SQM', condition_field: 'installation_type', condition_value: 'FRAME_BASED' },
  { sku: 'CSM-ADH-PNL-001', quantity_formula: 'PER_SQM', condition_field: null, condition_value: null },
  { sku: 'CSM-PVC-BCK-001', quantity_formula: 'PER_SQM', condition_field: 'moisture_level', condition_value: 'HIGH' },
];

// Space 1: TV_UNIT_WALL 3600×2700 STRAIGHT / WPC Oak / COVE_LIGHT / PREMIUM
const SPACE_1_INPUT: EngineInput = {
  wall_shape: 'STRAIGHT',
  width_mm: 3600,
  height_mm: 2700,
  template_id: 'b0000000-0000-0000-0000-000000000001',
  lighting_type: 'COVE_LIGHT',
  moisture_level: 'DRY',
  material_preference: 'WPC',
  compatible_materials: ['WPC', 'PVC'],
  panel_sku: 'WLP-WPC-CLS-OAK-001',
  panel_width_mm: 200,
  panel_height_mm: 2700,
  panel_unit_cost_paise: 32000,
  panel_sell_price_paise: 42000,
  panel_colour_variant: 'Oak',
  panel_finish_variant: 'WOOD_GRAIN',
  trim_elements: [OAK_TRIM],
  ...BASE_BOARD,
  template_consumables: FRAME_BASED_CONSUMABLES,
  furniture: [],
};

// Space 2: BED_BACK_WALL 3000×2700 STRAIGHT / WPC Oak / NONE / PREMIUM
const SPACE_2_INPUT: EngineInput = {
  wall_shape: 'STRAIGHT',
  width_mm: 3000,
  height_mm: 2700,
  template_id: 'b0000000-0000-0000-0000-000000000001',
  lighting_type: 'NONE',
  moisture_level: 'DRY',
  material_preference: 'WPC',
  compatible_materials: ['WPC', 'PVC'],
  panel_sku: 'WLP-WPC-CLS-OAK-001',
  panel_width_mm: 200,
  panel_height_mm: 2700,
  panel_unit_cost_paise: 32000,
  panel_sell_price_paise: 42000,
  panel_colour_variant: 'Oak',
  panel_finish_variant: 'WOOD_GRAIN',
  trim_elements: [OAK_TRIM],
  ...BASE_BOARD,
  template_consumables: DIRECT_CONSUMABLES,
  furniture: [],
};

// Space 3: BATHROOM_WALL 2400×2700 STRAIGHT / PVC White / NONE / STANDARD / moisture=HIGH
const SPACE_3_INPUT: EngineInput = {
  wall_shape: 'STRAIGHT',
  width_mm: 2400,
  height_mm: 2700,
  template_id: 'b0000000-0000-0000-0000-000000000002',
  lighting_type: 'NONE',
  moisture_level: 'HIGH',
  material_preference: 'PVC',
  compatible_materials: ['PVC'],
  panel_sku: 'WLP-PVC-STD-WHT-001',
  panel_width_mm: 200,
  panel_height_mm: 2700,
  panel_unit_cost_paise: 18000,
  panel_sell_price_paise: 24000,
  panel_colour_variant: 'White',
  panel_finish_variant: 'MATTE',
  trim_elements: [WHITE_TRIM],
  ...BASE_BOARD,
  template_consumables: DIRECT_CONSUMABLES,
  furniture: [],
};

describe('Integration: 3-Space Regression Fixture', () => {
  describe('Space 1: TV_UNIT_WALL (COVE_LIGHT, WPC Oak, DRY)', () => {
    it('produces correct engine output', async () => {
      const result = await runConfigurationEngine(SPACE_1_INPUT);

      // R1: COVE_LIGHT → FRAME_BASED
      expect(result.installation_type).toBe('FRAME_BASED');

      // R2+R3: COVE=10mm + DRY=0mm = 10mm
      expect(result.back_board_mm).toBe(10);

      // Area: 3600×2700 = 9,720,000
      expect(result.gross_area_sqmm).toBe(9720000);
      expect(result.net_area_sqmm).toBe(9720000);

      // R4: CEIL(9720000/(200×2700)) = 18 panels
      const panelItem = result.line_items.find(li => li.group_name === 'WALL_PANEL');
      expect(panelItem).toBeDefined();
      expect(panelItem!.quantity).toBe(18);
      expect(panelItem!.sku).toBe('WLP-WPC-CLS-OAK-001');

      // R5: trim quantity = 2(3600+2700)/304.8 = 41.34 rft
      const trimItem = result.line_items.find(li => li.group_name === 'TRIM');
      expect(trimItem).toBeDefined();
      expect(trimItem!.quantity).toBeCloseTo(41.34, 1);

      // R6: board needed (10mm > 0) → PER_SQM = 9.72 sqm
      const boardItem = result.line_items.find(li => li.sku === 'CSM-PVC-BSB-001' && li.generated_by_rule === 'R6');
      expect(boardItem).toBeDefined();
      expect(boardItem!.quantity).toBeCloseTo(9.72);

      // R7: FRAME_BASED → base board consumable included + adhesive included
      // moisture=DRY → moisture backing excluded
      const r7Items = result.line_items.filter(li => li.generated_by_rule === 'R7');
      expect(r7Items).toHaveLength(2); // BSB + ADH (not BCK — DRY)
      const adhesive = r7Items.find(li => li.sku === 'CSM-ADH-PNL-001');
      expect(adhesive).toBeDefined();
      expect(adhesive!.quantity).toBeCloseTo(9.72);
    });

    it('configuration_hash is a valid 64-char hex string', async () => {
      const result = await runConfigurationEngine(SPACE_1_INPUT);
      expect(result.configuration_hash).toHaveLength(64);
      expect(result.configuration_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('configuration_hash matches FROZEN baseline (Gate 1)', async () => {
      // FROZEN at Sprint 4 completion. Any change to this value is a REGRESSION.
      // Re-baseline requires documented justification in DECISIONS.md.
      const result = await runConfigurationEngine(SPACE_1_INPUT);
      expect(result.configuration_hash).toBe(
        'f8156a7e77a3f6dd0ec3df6b4bb9be6ed811ec488d2f9c904d5618d11ed7810e'
      );
    });

    it('configuration_hash is deterministic (same input → same hash)', async () => {
      const result1 = await runConfigurationEngine(SPACE_1_INPUT);
      const result2 = await runConfigurationEngine(SPACE_1_INPUT);
      expect(result1.configuration_hash).toBe(result2.configuration_hash);
    });
  });

  describe('Space 2: BED_BACK_WALL (NONE lighting, WPC Oak, DRY)', () => {
    it('produces correct engine output', async () => {
      const result = await runConfigurationEngine(SPACE_2_INPUT);

      // R1: NONE → DIRECT
      expect(result.installation_type).toBe('DIRECT');

      // R2+R3: NONE=0mm + DRY=0mm = 0mm (no base board)
      expect(result.back_board_mm).toBe(0);

      // Area: 3000×2700 = 8,100,000
      expect(result.gross_area_sqmm).toBe(8100000);

      // R4: CEIL(8100000/540000) = 15 panels
      const panelItem = result.line_items.find(li => li.group_name === 'WALL_PANEL');
      expect(panelItem!.quantity).toBe(15);

      // R5: trim = 2(3000+2700)/304.8 = 37.40 rft
      const trimItem = result.line_items.find(li => li.group_name === 'TRIM');
      expect(trimItem!.quantity).toBeCloseTo(37.40, 1);

      // R6: no board (thickness=0) → null (not in line_items)
      const boardItem = result.line_items.find(li => li.generated_by_rule === 'R6');
      expect(boardItem).toBeUndefined();

      // R7: DIRECT → base board excluded; adhesive included (unconditional); moisture excluded (DRY)
      const r7Items = result.line_items.filter(li => li.generated_by_rule === 'R7');
      expect(r7Items).toHaveLength(1); // only adhesive
      expect(r7Items[0].sku).toBe('CSM-ADH-PNL-001');
    });
  });

  describe('Space 3: BATHROOM_WALL (NONE lighting, PVC White, HIGH moisture)', () => {
    it('produces correct engine output', async () => {
      const result = await runConfigurationEngine(SPACE_3_INPUT);

      // R1: NONE → DIRECT
      expect(result.installation_type).toBe('DIRECT');

      // R2+R3: NONE=0mm + HIGH=5mm = 5mm (moisture board only)
      expect(result.back_board_mm).toBe(5);

      // Area: 2400×2700 = 6,480,000
      expect(result.gross_area_sqmm).toBe(6480000);

      // R4: CEIL(6480000/540000) = 12 panels
      const panelItem = result.line_items.find(li => li.group_name === 'WALL_PANEL');
      expect(panelItem!.quantity).toBe(12);
      expect(panelItem!.sku).toBe('WLP-PVC-STD-WHT-001');

      // R5: trim = 2(2400+2700)/304.8 = 33.46 rft
      const trimItem = result.line_items.find(li => li.group_name === 'TRIM');
      expect(trimItem!.quantity).toBeCloseTo(33.46, 1);
      expect(trimItem!.sku).toBe('TRM-WHT-SGP-001');

      // R6: board needed (5mm > 0) → PER_SQM = 6.48 sqm
      const boardItem = result.line_items.find(li => li.generated_by_rule === 'R6');
      expect(boardItem).toBeDefined();
      expect(boardItem!.quantity).toBeCloseTo(6.48);

      // R7: DIRECT → base board excluded; adhesive included; HIGH → moisture backing included
      const r7Items = result.line_items.filter(li => li.generated_by_rule === 'R7');
      expect(r7Items).toHaveLength(2); // adhesive + moisture backing
      const moisture = r7Items.find(li => li.sku === 'CSM-PVC-BCK-001');
      expect(moisture).toBeDefined();
      expect(moisture!.quantity).toBeCloseTo(6.48);
    });
  });

  describe('Cross-space properties', () => {
    it('all 3 spaces produce different configuration_hashes', async () => {
      const [r1, r2, r3] = await Promise.all([
        runConfigurationEngine(SPACE_1_INPUT),
        runConfigurationEngine(SPACE_2_INPUT),
        runConfigurationEngine(SPACE_3_INPUT),
      ]);

      // All different (different templates, measurements, lighting)
      expect(r1.configuration_hash).not.toBe(r2.configuration_hash);
      expect(r1.configuration_hash).not.toBe(r3.configuration_hash);
      expect(r2.configuration_hash).not.toBe(r3.configuration_hash);
    });

    it('FROZEN baselines for all 3 spaces (Gate 1 regression)', async () => {
      // FROZEN at Sprint 4. Any change is a REGRESSION requiring re-baseline.
      const [r1, r2, r3] = await Promise.all([
        runConfigurationEngine(SPACE_1_INPUT),
        runConfigurationEngine(SPACE_2_INPUT),
        runConfigurationEngine(SPACE_3_INPUT),
      ]);

      expect(r1.configuration_hash).toBe('f8156a7e77a3f6dd0ec3df6b4bb9be6ed811ec488d2f9c904d5618d11ed7810e');
      expect(r2.configuration_hash).toBe('b47529d208a49638c7191a3d5fef23ff3bf6133a3d716ef0043be5d351bbaa25');
      expect(r3.configuration_hash).toBe('3022c37285ec55dc14f4a9c2fce6ac113c6f903fbaf1776e550a07cd177ca202');
    });

    it('each space hash is deterministic across runs', async () => {
      const run1 = await Promise.all([
        runConfigurationEngine(SPACE_1_INPUT),
        runConfigurationEngine(SPACE_2_INPUT),
        runConfigurationEngine(SPACE_3_INPUT),
      ]);
      const run2 = await Promise.all([
        runConfigurationEngine(SPACE_1_INPUT),
        runConfigurationEngine(SPACE_2_INPUT),
        runConfigurationEngine(SPACE_3_INPUT),
      ]);

      expect(run1[0].configuration_hash).toBe(run2[0].configuration_hash);
      expect(run1[1].configuration_hash).toBe(run2[1].configuration_hash);
      expect(run1[2].configuration_hash).toBe(run2[2].configuration_hash);
    });
  });

  describe('Pre-run guard', () => {
    it('TEMPLATE_MATERIAL_MISMATCH when material not in compatible_materials', async () => {
      const badInput = {
        ...SPACE_1_INPUT,
        material_preference: 'UV_MARBLE', // not in ['WPC', 'PVC']
      };
      await expect(runConfigurationEngine(badInput)).rejects.toThrow('TEMPLATE_MATERIAL_MISMATCH');
    });
  });
});
