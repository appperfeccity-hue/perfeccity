/**
 * Quotation Engine — 3-Space Regression Fixture (Sprint 5 T2)
 *
 * Hand-computed expected values for each intermediate step.
 * Uses the same 3-space fixture from Sprint 4's configuration engine
 * (TV_UNIT_WALL + BED_BACK_WALL + BATHROOM_WALL).
 *
 * Pricing basis: unit_cost_paise (AD-29 confirmed).
 * Rounding: Math.round() at Steps 12, 13, and final grand_total (AD-30).
 *
 * Pricing settings (spec defaults):
 *   LABOUR_DIRECT = 15000 paise/sqm
 *   LABOUR_FRAME = 25000 paise/sqm
 *   TRANSPORT = 500000 paise (flat per project)
 *
 * FIXTURE DATA SOURCE:
 *   Config engine regression fixture outputs (verified in Sprint 4):
 *   Space 1: 18 panels (WPC Oak @32000), trim 41.3386 rft (@4800),
 *            board 9.72 sqm (@8500), frame-board 9.72 (@8500), adhesive 9.72 (@12000)
 *   Space 2: 15 panels (WPC Oak @32000), trim 37.4016 rft (@4800),
 *            adhesive 8.1 (@12000)
 *   Space 3: 12 panels (PVC White @18000), trim 33.4646 rft (@4500),
 *            board 6.48 sqm (@8500), adhesive 6.48 (@12000), moisture-back 6.48 (@8500)
 */

import { describe, it, expect } from 'vitest';
import { runQuotationEngine, QuotationInput, ConfigLineItem, SpaceContext } from '../src/index';

// ============================================================
// FIXTURE: 3-space project (same as Sprint 4 regression fixture)
// ============================================================

const PRICING_SETTINGS = {
  labour_direct_paise_per_sqm: 15000,
  labour_frame_paise_per_sqm: 25000,
  transport_flat_rate_paise: 500000,
};

const SPACES: SpaceContext[] = [
  {
    space_id: 'space-1-tv-unit',
    space_type: 'TV_UNIT_WALL',
    installation_type: 'FRAME_BASED',
    net_area_sqmm: 9720000,
    moisture_level: 'DRY',
  },
  {
    space_id: 'space-2-bed-back',
    space_type: 'BED_BACK_WALL',
    installation_type: 'DIRECT',
    net_area_sqmm: 8100000,
    moisture_level: 'DRY',
  },
  {
    space_id: 'space-3-bathroom',
    space_type: 'BATHROOM_WALL',
    installation_type: 'DIRECT',
    net_area_sqmm: 6480000,
    moisture_level: 'HIGH',
  },
];

// Line items assembled from config engine output (Sprint 4 proven values)
const LINE_ITEMS: ConfigLineItem[] = [
  // === Space 1 (FRAME_BASED, COVE_LIGHT, DRY) ===
  { space_id: 'space-1-tv-unit', sku: 'WLP-WPC-CLS-OAK-001', product_role: 'PRIMARY', quantity: 18, unit_label: 'panels', unit_cost_paise: 32000, group_name: 'WALL_PANEL', generated_by_rule: 'R4' },
  { space_id: 'space-1-tv-unit', sku: 'TRM-OAK-SGP-001', product_role: 'TRIM', quantity: 41.338582677165356, unit_label: 'rft', unit_cost_paise: 4800, group_name: 'TRIM', generated_by_rule: 'R5' },
  { space_id: 'space-1-tv-unit', sku: 'CSM-PVC-BSB-001', product_role: 'CONSUMABLE', quantity: 9.72, unit_label: 'sqm', unit_cost_paise: 8500, group_name: 'CONSUMABLE', generated_by_rule: 'R6' },
  { space_id: 'space-1-tv-unit', sku: 'CSM-PVC-BSB-001', product_role: 'CONSUMABLE', quantity: 9.72, unit_label: 'sqm', unit_cost_paise: 8500, group_name: 'CONSUMABLE', generated_by_rule: 'R7' },
  { space_id: 'space-1-tv-unit', sku: 'CSM-ADH-PNL-001', product_role: 'CONSUMABLE', quantity: 9.72, unit_label: 'sqm', unit_cost_paise: 12000, group_name: 'CONSUMABLE', generated_by_rule: 'R7' },

  // === Space 2 (DIRECT, NONE lighting, DRY) ===
  { space_id: 'space-2-bed-back', sku: 'WLP-WPC-CLS-OAK-001', product_role: 'PRIMARY', quantity: 15, unit_label: 'panels', unit_cost_paise: 32000, group_name: 'WALL_PANEL', generated_by_rule: 'R4' },
  { space_id: 'space-2-bed-back', sku: 'TRM-OAK-SGP-001', product_role: 'TRIM', quantity: 37.40157480314961, unit_label: 'rft', unit_cost_paise: 4800, group_name: 'TRIM', generated_by_rule: 'R5' },
  { space_id: 'space-2-bed-back', sku: 'CSM-ADH-PNL-001', product_role: 'CONSUMABLE', quantity: 8.1, unit_label: 'sqm', unit_cost_paise: 12000, group_name: 'CONSUMABLE', generated_by_rule: 'R7' },

  // === Space 3 (DIRECT, NONE lighting, HIGH moisture) ===
  { space_id: 'space-3-bathroom', sku: 'WLP-PVC-STD-WHT-001', product_role: 'PRIMARY', quantity: 12, unit_label: 'panels', unit_cost_paise: 18000, group_name: 'WALL_PANEL', generated_by_rule: 'R4' },
  { space_id: 'space-3-bathroom', sku: 'TRM-WHT-SGP-001', product_role: 'TRIM', quantity: 33.46456692913386, unit_label: 'rft', unit_cost_paise: 4500, group_name: 'TRIM', generated_by_rule: 'R5' },
  { space_id: 'space-3-bathroom', sku: 'CSM-PVC-BSB-001', product_role: 'CONSUMABLE', quantity: 6.48, unit_label: 'sqm', unit_cost_paise: 8500, group_name: 'CONSUMABLE', generated_by_rule: 'R6' },
  { space_id: 'space-3-bathroom', sku: 'CSM-ADH-PNL-001', product_role: 'CONSUMABLE', quantity: 6.48, unit_label: 'sqm', unit_cost_paise: 12000, group_name: 'CONSUMABLE', generated_by_rule: 'R7' },
  { space_id: 'space-3-bathroom', sku: 'CSM-PVC-BCK-001', product_role: 'CONSUMABLE', quantity: 6.48, unit_label: 'sqm', unit_cost_paise: 8500, group_name: 'CONSUMABLE', generated_by_rule: 'R7' },
];

const FIXTURE_INPUT: QuotationInput = {
  project_id: 'test-project-quotation-regression',
  spaces: SPACES,
  line_items: LINE_ITEMS,
  furniture: [], // No furniture in this fixture
  pricing_settings: PRICING_SETTINGS,
};

// ============================================================
// HAND-COMPUTED EXPECTED VALUES
// ============================================================

/**
 * Step 4: wall_panel_total = Σ(qty × unit_cost)
 *   Space1: 18 × 32000 = 576,000
 *   Space2: 15 × 32000 = 480,000
 *   Space3: 12 × 18000 = 216,000
 *   TOTAL = 1,272,000
 */
const EXPECTED_STEP_4 = 1_272_000;

/**
 * Step 5 trim: Σ(qty × unit_cost)
 *   Space1: 41.338582677165356 × 4800 = 198,425.1968503937
 *   Space2: 37.40157480314961 × 4800  = 179,527.55905511812
 *   Space3: 33.46456692913386 × 4500  = 150,590.55118110238
 *   TOTAL = 528,543.3070866142
 */
const EXPECTED_STEP_5_TRIM = 41.338582677165356 * 4800 + 37.40157480314961 * 4800 + 33.46456692913386 * 4500;

/**
 * Step 5 consumables: Σ(qty × unit_cost)
 *   Space1 R6: 9.72 × 8500 = 82,620
 *   Space1 R7 BSB: 9.72 × 8500 = 82,620
 *   Space1 R7 ADH: 9.72 × 12000 = 116,640
 *   Space2 R7 ADH: 8.1 × 12000 = 97,200
 *   Space3 R6: 6.48 × 8500 = 55,080
 *   Space3 R7 ADH: 6.48 × 12000 = 77,760
 *   Space3 R7 BCK: 6.48 × 8500 = 55,080
 *   TOTAL = 567,000
 */
const EXPECTED_STEP_5_CONSUMABLE = 567_000;

const EXPECTED_STEP_5_LIGHTING = 0;
const EXPECTED_STEP_5_NON_PANEL = EXPECTED_STEP_5_TRIM + EXPECTED_STEP_5_LIGHTING + EXPECTED_STEP_5_CONSUMABLE;

/**
 * Step 8: labour = Σ(net_area_sqm × rate)
 *   Space1: 9.72 sqm × 25000 (FRAME_BASED) = 243,000
 *   Space2: 8.1 sqm × 15000 (DIRECT) = 121,500
 *   Space3: 6.48 sqm × 15000 (DIRECT) = 97,200
 *   TOTAL = 461,700
 */
const EXPECTED_STEP_8 = 461_700;

/** Step 9: transport = 500,000 (flat) */
const EXPECTED_STEP_9 = 500_000;

/** Step 10: furniture = 0 (none in fixture) */
const EXPECTED_STEP_10 = 0;

/** Step 11: subtotal = 4 + 5 + 8 + 9 + 10 */
const EXPECTED_STEP_11 = EXPECTED_STEP_4 + EXPECTED_STEP_5_NON_PANEL + EXPECTED_STEP_8 + EXPECTED_STEP_9 + EXPECTED_STEP_10;

/** Step 12: margin = Math.round(subtotal × 0.25) */
const EXPECTED_STEP_12_MARGIN = Math.round(EXPECTED_STEP_11 * 0.25);
const EXPECTED_STEP_12_PRE_GST = EXPECTED_STEP_11 + EXPECTED_STEP_12_MARGIN;

/** Step 13: gst = Math.round(pre_gst × 0.18), grand = Math.round(pre_gst + gst) */
const EXPECTED_STEP_13_GST = Math.round(EXPECTED_STEP_12_PRE_GST * 0.18);
const EXPECTED_GRAND_TOTAL = Math.round(EXPECTED_STEP_12_PRE_GST + EXPECTED_STEP_13_GST);

// ============================================================
// TESTS
// ============================================================

describe('Quotation Engine: 3-Space Regression Fixture', () => {
  const result = runQuotationEngine(FIXTURE_INPUT);

  describe('Step 4: Wall panel costs (AD-29: unit_cost_paise)', () => {
    it('wall_panel_total = 1,272,000 paise (18×32000 + 15×32000 + 12×18000)', () => {
      expect(result.step_breakdown.step_4_wall_panel_total_paise).toBe(EXPECTED_STEP_4);
    });
  });

  describe('Step 5: Non-panel costs (trim + consumables)', () => {
    it('trim_total matches hand-computed value', () => {
      expect(result.step_breakdown.step_5_trim_total_paise).toBeCloseTo(EXPECTED_STEP_5_TRIM, 5);
    });

    it('consumable_total = 567,000 paise (all integer multiplications)', () => {
      expect(result.step_breakdown.step_5_consumable_total_paise).toBe(EXPECTED_STEP_5_CONSUMABLE);
    });

    it('lighting_total = 0 (no lighting items in fixture)', () => {
      expect(result.step_breakdown.step_5_lighting_total_paise).toBe(EXPECTED_STEP_5_LIGHTING);
    });

    it('non_panel_total = trim + lighting + consumable', () => {
      expect(result.step_breakdown.step_5_non_panel_total_paise).toBeCloseTo(EXPECTED_STEP_5_NON_PANEL, 5);
    });
  });

  describe('Step 6: Structural check (FRAME_BASED spaces need R6 board)', () => {
    it('passes — Space 1 is FRAME_BASED and has an R6 item', () => {
      expect(result.step_breakdown.step_6_structural_check).toBe('PASS');
    });
  });

  describe('Step 7: Moisture check (HIGH-moisture spaces need backing)', () => {
    it('passes — Space 3 is HIGH moisture and has CSM-PVC-BCK-001', () => {
      expect(result.step_breakdown.step_7_moisture_check).toBe('PASS');
    });
  });

  describe('Step 8: Labour costs', () => {
    it('labour_total = 461,700 paise (9.72×25000 + 8.1×15000 + 6.48×15000)', () => {
      expect(result.step_breakdown.step_8_labour_total_paise).toBe(EXPECTED_STEP_8);
    });
  });

  describe('Step 9: Transport', () => {
    it('transport = 500,000 paise (flat rate per project)', () => {
      expect(result.step_breakdown.step_9_transport_paise).toBe(EXPECTED_STEP_9);
    });
  });

  describe('Step 10: Furniture', () => {
    it('furniture_total = 0 (no furniture in fixture)', () => {
      expect(result.step_breakdown.step_10_furniture_total_paise).toBe(EXPECTED_STEP_10);
    });
  });

  describe('Step 11: Subtotal (4+5+8+9+10)', () => {
    it('subtotal matches hand-computed sum', () => {
      expect(result.step_breakdown.step_11_subtotal_paise).toBeCloseTo(EXPECTED_STEP_11, 5);
    });
  });

  describe('Step 12: Margin (AD-30: Math.round)', () => {
    it('margin = Math.round(subtotal × 0.25) = 832,311', () => {
      expect(result.step_breakdown.step_12_margin_paise).toBe(EXPECTED_STEP_12_MARGIN);
      expect(EXPECTED_STEP_12_MARGIN).toBe(832311); // frozen
    });

    it('pre_gst = subtotal + margin', () => {
      expect(result.step_breakdown.step_12_pre_gst_total_paise).toBeCloseTo(EXPECTED_STEP_12_PRE_GST, 5);
    });
  });

  describe('Step 13: GST + Grand Total (AD-30: Math.round)', () => {
    it('gst = Math.round(pre_gst × 0.18) = 749,080', () => {
      expect(result.step_breakdown.step_13_gst_paise).toBe(EXPECTED_STEP_13_GST);
      expect(EXPECTED_STEP_13_GST).toBe(749080); // frozen
    });

    it('grand_total = Math.round(pre_gst + gst) = 4,910,634', () => {
      expect(result.step_breakdown.step_13_grand_total_paise).toBe(EXPECTED_GRAND_TOTAL);
      expect(EXPECTED_GRAND_TOTAL).toBe(4910634); // frozen
    });
  });

  describe('Overall output', () => {
    it('grand_total_paise matches step_breakdown', () => {
      expect(result.grand_total_paise).toBe(result.step_breakdown.step_13_grand_total_paise);
    });

    it('validation_passed = true (all checks pass)', () => {
      expect(result.validation_passed).toBe(true);
      expect(result.validation_errors).toEqual([]);
    });

    it('FROZEN grand_total_paise = 4,910,634 (regression baseline)', () => {
      expect(result.grand_total_paise).toBe(4910634);
    });
  });

  describe('Determinism', () => {
    it('same input produces same output on repeated runs', () => {
      const r1 = runQuotationEngine(FIXTURE_INPUT);
      const r2 = runQuotationEngine(FIXTURE_INPUT);
      expect(r1.grand_total_paise).toBe(r2.grand_total_paise);
      expect(r1.step_breakdown).toEqual(r2.step_breakdown);
    });
  });
});

describe('Quotation Engine: Validation failure cases', () => {
  describe('Step 6 failure: FRAME_BASED without structural board', () => {
    it('fails when FRAME_BASED space has no R6 line item', () => {
      // Remove R6 items from Space 1
      const badItems = LINE_ITEMS.filter(
        li => !(li.space_id === 'space-1-tv-unit' && li.generated_by_rule === 'R6')
      );
      const result = runQuotationEngine({
        ...FIXTURE_INPUT,
        line_items: badItems,
      });
      expect(result.step_breakdown.step_6_structural_check).toBe('FAIL');
      expect(result.validation_passed).toBe(false);
      expect(result.validation_errors[0]).toContain('FRAME_BASED');
      expect(result.validation_errors[0]).toContain('structural board');
    });
  });

  describe('Step 7 failure: HIGH moisture without backing', () => {
    it('fails when HIGH moisture space has no R6 board and no moisture backing', () => {
      // Remove R6 and BCK items from Space 3
      const badItems = LINE_ITEMS.filter(
        li => !(
          li.space_id === 'space-3-bathroom' &&
          (li.generated_by_rule === 'R6' || li.sku === 'CSM-PVC-BCK-001')
        )
      );
      const result = runQuotationEngine({
        ...FIXTURE_INPUT,
        line_items: badItems,
      });
      expect(result.step_breakdown.step_7_moisture_check).toBe('FAIL');
      expect(result.validation_passed).toBe(false);
      expect(result.validation_errors[0]).toContain('HIGH moisture');
    });
  });
});

describe('Quotation Engine: Furniture fixture', () => {
  it('includes furniture cost in subtotal and grand_total', () => {
    const withFurniture: QuotationInput = {
      ...FIXTURE_INPUT,
      furniture: [
        { space_id: 'space-1-tv-unit', sku: 'FRN-TV-UNIT-001', quantity: 1, calculated_cost_paise: 250000 },
        { space_id: 'space-2-bed-back', sku: 'FRN-SIDE-TABLE-001', quantity: 2, calculated_cost_paise: 180000 },
      ],
    };
    const result = runQuotationEngine(withFurniture);

    // Furniture total = 250000 + 180000 = 430000
    expect(result.step_breakdown.step_10_furniture_total_paise).toBe(430000);

    // Subtotal increases by 430000
    const expectedSubtotal = EXPECTED_STEP_11 + 430000;
    expect(result.step_breakdown.step_11_subtotal_paise).toBeCloseTo(expectedSubtotal, 5);

    // Grand total recalculated with furniture
    const margin = Math.round(expectedSubtotal * 0.25);
    const preGst = expectedSubtotal + margin;
    const gst = Math.round(preGst * 0.18);
    const grand = Math.round(preGst + gst);
    expect(result.grand_total_paise).toBe(grand);
  });
});
