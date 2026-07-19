/**
 * Rule R5 Tests — Trim Auto-Link
 * 
 * ACTUALLY EXECUTED. Formula-derived (PER_RFT_PERIMETER arithmetic + ACTIVE check).
 * No spec-interpretation needed — matching logic clear from seed data.
 */

import { describe, it, expect } from 'vitest';
import { computeTrimLineItems, TrimElement } from '../../src/rules/r5-trim-auto-link';

const OAK_TRIM: TrimElement = {
  sku: 'TRM-OAK-SGP-001',
  colour_variant: 'Oak',
  finish_variant: null,
  default_quantity: 1,
  sku_status: 'ACTIVE',
  sku_is_active: true,
  unit_cost_paise: 4800,
  sell_price_paise: 6240,
};

const WHITE_TRIM: TrimElement = {
  sku: 'TRM-WHT-SGP-001',
  colour_variant: 'White',
  finish_variant: null,
  default_quantity: 1,
  sku_status: 'ACTIVE',
  sku_is_active: true,
  unit_cost_paise: 4500,
  sell_price_paise: 5850,
};

const INACTIVE_TRIM: TrimElement = {
  sku: 'TRM-OLD-001',
  colour_variant: 'Oak',
  finish_variant: null,
  default_quantity: 1,
  sku_status: 'INACTIVE',
  sku_is_active: false,
  unit_cost_paise: 4800,
  sell_price_paise: 6240,
};

describe('R5: computeTrimLineItems', () => {
  describe('Happy path — active trims', () => {
    it('regression fixture space 1: TV_UNIT_WALL 3600×2700, Oak trim → 41.34 rft', () => {
      // Formula-derived:
      // perimeter = 2(3600+2700) = 12,600mm
      // rft = 12600 / 304.8 = 41.3386...
      // quantity = 41.3386 × default_quantity(1) = 41.3386
      const result = computeTrimLineItems({
        trim_elements: [OAK_TRIM],
        width_mm: 3600,
        height_mm: 2700,
      });

      expect(result).toHaveLength(1);
      expect(result[0].sku).toBe('TRM-OAK-SGP-001');
      expect(result[0].quantity).toBeCloseTo(41.34, 1);
      expect(result[0].unit_label).toBe('rft');
      expect(result[0].product_role).toBe('TRIM');
      expect(result[0].group_name).toBe('TRIM');
      expect(result[0].generated_by_rule).toBe('R5');
      expect(result[0].colour_variant).toBe('Oak');
      expect(result[0].unit_cost_paise).toBe(4800);
      expect(result[0].sell_price_paise).toBe(6240);
    });

    it('regression fixture space 2: BED_BACK_WALL 3000×2700, Oak trim → 37.40 rft', () => {
      // Formula-derived: 2(3000+2700) = 11400mm. 11400/304.8 = 37.4016
      const result = computeTrimLineItems({
        trim_elements: [OAK_TRIM],
        width_mm: 3000,
        height_mm: 2700,
      });

      expect(result).toHaveLength(1);
      expect(result[0].quantity).toBeCloseTo(37.40, 1);
    });

    it('regression fixture space 3: BATHROOM_WALL 2400×2700, White trim → 33.46 rft', () => {
      // Formula-derived: 2(2400+2700) = 10200mm. 10200/304.8 = 33.4646
      const result = computeTrimLineItems({
        trim_elements: [WHITE_TRIM],
        width_mm: 2400,
        height_mm: 2700,
      });

      expect(result).toHaveLength(1);
      expect(result[0].quantity).toBeCloseTo(33.46, 1);
      expect(result[0].sku).toBe('TRM-WHT-SGP-001');
    });
  });

  describe('No trim elements', () => {
    it('empty trim_elements → empty array (valid)', () => {
      const result = computeTrimLineItems({
        trim_elements: [],
        width_mm: 3600,
        height_mm: 2700,
      });

      expect(result).toHaveLength(0);
    });
  });

  describe('Inactive trim guard (422 TRIM_SKU_NOT_FOUND)', () => {
    it('inactive trim SKU → throws TRIM_SKU_NOT_FOUND', () => {
      expect(() => computeTrimLineItems({
        trim_elements: [INACTIVE_TRIM],
        width_mm: 3600,
        height_mm: 2700,
      })).toThrow('TRIM_SKU_NOT_FOUND');
    });

    it('mix of active + inactive → throws (fails on first inactive)', () => {
      expect(() => computeTrimLineItems({
        trim_elements: [OAK_TRIM, INACTIVE_TRIM],
        width_mm: 3600,
        height_mm: 2700,
      })).toThrow('TRIM_SKU_NOT_FOUND');
    });
  });

  describe('Multiple trims on one template', () => {
    it('two active trims → two line items with same quantity', () => {
      const result = computeTrimLineItems({
        trim_elements: [OAK_TRIM, WHITE_TRIM],
        width_mm: 3600,
        height_mm: 2700,
      });

      expect(result).toHaveLength(2);
      // Both get same perimeter-based quantity
      expect(result[0].quantity).toBeCloseTo(41.34, 1);
      expect(result[1].quantity).toBeCloseTo(41.34, 1);
    });
  });

  describe('default_quantity multiplier', () => {
    it('default_quantity=2 doubles the computed rft', () => {
      const doubleTrim = { ...OAK_TRIM, default_quantity: 2 };
      const result = computeTrimLineItems({
        trim_elements: [doubleTrim],
        width_mm: 3600,
        height_mm: 2700,
      });

      // 41.3386 × 2 = 82.677
      expect(result[0].quantity).toBeCloseTo(82.68, 1);
    });
  });
});
