/**
 * Rule R4 Tests — Panel Quantity Calculation
 * 
 * ACTUALLY EXECUTED. Formula-derived fixtures with derivations.
 * Uses the regression fixture from Part 8 (3 spaces).
 * No spec-interpretation needed (frozen arithmetic formula).
 */

import { describe, it, expect } from 'vitest';
import { computePanelLineItem, PanelInput } from '../../src/rules/r4-panel-quantity';

// Seed data panel SKUs (from Part 11)
const WPC_OAK: Pick<PanelInput, 'panel_sku' | 'panel_width_mm' | 'panel_height_mm' | 'panel_unit_cost_paise' | 'panel_sell_price_paise'> = {
  panel_sku: 'WLP-WPC-CLS-OAK-001',
  panel_width_mm: 200,
  panel_height_mm: 2700,
  panel_unit_cost_paise: 32000,
  panel_sell_price_paise: 42000,
};

const PVC_WHITE: Pick<PanelInput, 'panel_sku' | 'panel_width_mm' | 'panel_height_mm' | 'panel_unit_cost_paise' | 'panel_sell_price_paise'> = {
  panel_sku: 'WLP-PVC-STD-WHT-001',
  panel_width_mm: 200,
  panel_height_mm: 2700,
  panel_unit_cost_paise: 18000,
  panel_sell_price_paise: 24000,
};

const UV_MARBLE: Pick<PanelInput, 'panel_sku' | 'panel_width_mm' | 'panel_height_mm' | 'panel_unit_cost_paise' | 'panel_sell_price_paise'> = {
  panel_sku: 'WLP-UVM-MRB-WHT-001',
  panel_width_mm: 600,
  panel_height_mm: 1200,
  panel_unit_cost_paise: 55000,
  panel_sell_price_paise: 72000,
};

describe('R4: computePanelLineItem', () => {
  describe('Regression fixture (Part 8, 3-space project)', () => {
    it('Space 1: TV_UNIT_WALL 3600×2700 STRAIGHT, WPC Oak → 18 panels', () => {
      // Formula-derived:
      // gross = 3600×2700 = 9,720,000. net = 9,720,000 (no deduction).
      // panel = 200×2700 = 540,000. CEIL(9720000/540000) = CEIL(18.0) = 18.
      const result = computePanelLineItem({
        wall_shape: 'STRAIGHT',
        width_mm: 3600,
        height_mm: 2700,
        ...WPC_OAK,
      });

      expect(result.quantity).toBe(18);
      expect(result.sku).toBe('WLP-WPC-CLS-OAK-001');
      expect(result.product_role).toBe('PRIMARY');
      expect(result.unit_label).toBe('pc');
      expect(result.group_name).toBe('WALL_PANEL');
      expect(result.generated_by_rule).toBe('R4');
      expect(result._gross_area_sqmm).toBe(9720000);
      expect(result._net_area_sqmm).toBe(9720000);
    });

    it('Space 2: BED_BACK_WALL 3000×2700 STRAIGHT, WPC Oak → 15 panels', () => {
      // Formula-derived:
      // gross = 3000×2700 = 8,100,000. net = 8,100,000.
      // CEIL(8100000/540000) = CEIL(15.0) = 15.
      const result = computePanelLineItem({
        wall_shape: 'STRAIGHT',
        width_mm: 3000,
        height_mm: 2700,
        ...WPC_OAK,
      });

      expect(result.quantity).toBe(15);
      expect(result._gross_area_sqmm).toBe(8100000);
    });

    it('Space 3: BATHROOM_WALL 2400×2700 STRAIGHT, PVC White → 12 panels', () => {
      // Formula-derived:
      // gross = 2400×2700 = 6,480,000. net = 6,480,000.
      // CEIL(6480000/540000) = CEIL(12.0) = 12.
      const result = computePanelLineItem({
        wall_shape: 'STRAIGHT',
        width_mm: 2400,
        height_mm: 2700,
        ...PVC_WHITE,
      });

      expect(result.quantity).toBe(12);
      expect(result.unit_cost_paise).toBe(18000);
      expect(result.sell_price_paise).toBe(24000);
    });
  });

  describe('Different panel sizes', () => {
    it('UV_MARBLE 600×1200 on 3600×2700 → 14 panels', () => {
      // Formula-derived:
      // gross = 9,720,000. panel = 600×1200 = 720,000.
      // CEIL(9720000/720000) = CEIL(13.5) = 14.
      const result = computePanelLineItem({
        wall_shape: 'STRAIGHT',
        width_mm: 3600,
        height_mm: 2700,
        ...UV_MARBLE,
      });

      expect(result.quantity).toBe(14);
      expect(result._panel_area_sqmm).toBe(720000);
    });
  });

  describe('L_SHAPE and C_SHAPE', () => {
    it('L_SHAPE 3000×2700 + segment_b=1200, WPC Oak → 21 panels', () => {
      // Formula-derived:
      // gross = (3000×2700) + (1200×2700) = 8,100,000 + 3,240,000 = 11,340,000
      // panel = 540,000. CEIL(11340000/540000) = CEIL(21.0) = 21.
      const result = computePanelLineItem({
        wall_shape: 'L_SHAPE',
        width_mm: 3000,
        height_mm: 2700,
        segment_b_mm: 1200,
        ...WPC_OAK,
      });

      expect(result.quantity).toBe(21);
      expect(result._gross_area_sqmm).toBe(11340000);
    });

    it('C_SHAPE 3000×2700 + 1200 + 900, WPC Oak → 26 panels', () => {
      // Formula-derived:
      // gross = 8,100,000 + 3,240,000 + 2,430,000 = 13,770,000
      // CEIL(13770000/540000) = CEIL(25.5) = 26.
      const result = computePanelLineItem({
        wall_shape: 'C_SHAPE',
        width_mm: 3000,
        height_mm: 2700,
        segment_b_mm: 1200,
        segment_c_mm: 900,
        ...WPC_OAK,
      });

      expect(result.quantity).toBe(26);
      expect(result._gross_area_sqmm).toBe(13770000);
    });
  });

  describe('Opening deductions', () => {
    it('3600×2700 with 1,000,000 sqmm deduction → 17 panels', () => {
      // Formula-derived:
      // gross = 9,720,000. deduction = 1,000,000. net = 8,720,000.
      // CEIL(8720000/540000) = CEIL(16.148...) = 17.
      const result = computePanelLineItem({
        wall_shape: 'STRAIGHT',
        width_mm: 3600,
        height_mm: 2700,
        opening_deduction_sqmm: 1000000,
        ...WPC_OAK,
      });

      expect(result.quantity).toBe(17);
      expect(result._net_area_sqmm).toBe(8720000);
    });

    it('deduction >= gross area → throws INVALID_NET_AREA', () => {
      expect(() => computePanelLineItem({
        wall_shape: 'STRAIGHT',
        width_mm: 3600,
        height_mm: 2700,
        opening_deduction_sqmm: 10000000, // exceeds gross
        ...WPC_OAK,
      })).toThrow('INVALID_NET_AREA');
    });
  });

  describe('Edge cases and validation', () => {
    it('panel with null width_mm → throws', () => {
      expect(() => computePanelLineItem({
        wall_shape: 'STRAIGHT',
        width_mm: 3600,
        height_mm: 2700,
        panel_sku: 'BAD-SKU',
        panel_width_mm: 0,
        panel_height_mm: 2700,
        panel_unit_cost_paise: 10000,
        panel_sell_price_paise: 15000,
      })).toThrow('invalid width_mm');
    });

    it('output line item has all required fields for configuration_line_items', () => {
      const result = computePanelLineItem({
        wall_shape: 'STRAIGHT',
        width_mm: 3600,
        height_mm: 2700,
        ...WPC_OAK,
      });

      // These fields map directly to configuration_line_items columns
      expect(result).toHaveProperty('sku');
      expect(result).toHaveProperty('product_role');
      expect(result).toHaveProperty('quantity');
      expect(result).toHaveProperty('unit_label');
      expect(result).toHaveProperty('unit_cost_paise');
      expect(result).toHaveProperty('sell_price_paise');
      expect(result).toHaveProperty('group_name');
      expect(result).toHaveProperty('generated_by_rule');
    });
  });
});
