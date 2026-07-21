/**
 * Rule R6 Tests — Structural Board Addition
 * Conditional: only adds board when thickness > 0 (R2/R3 determined need).
 * Formula-derived (PER_SQM arithmetic + conditional logic).
 */

import { describe, it, expect } from 'vitest';
import { computeStructuralBoardLineItem } from '../../src/rules/r6-structural-board';

// Seed data: CSM-PVC-BSB-001 Base Board 10mm, ₹85/sqm
const BASE_BOARD_SKU = {
  board_sku: 'CSM-PVC-BSB-001',
  board_unit_cost_paise: 8500,
  board_sell_price_paise: 11050,
};

describe('R6: computeStructuralBoardLineItem', () => {
  describe('Board needed (thickness > 0)', () => {
    it('COVE_LIGHT + DRY (10mm board) on 9,720,000 sqmm → 9.72 sqm', () => {
      // Formula-derived:
      // thickness = 10mm (R2=COVE), net_area = 9,720,000 sqmm
      // quantity = 9720000 / 1000000 = 9.72 sqm
      const result = computeStructuralBoardLineItem({
        total_board_thickness_mm: 10,
        net_area_sqmm: 9720000,
        ...BASE_BOARD_SKU,
      });

      expect(result).not.toBeNull();
      expect(result!.quantity).toBeCloseTo(9.72);
      expect(result!.sku).toBe('CSM-PVC-BSB-001');
      expect(result!.product_role).toBe('CONSUMABLE');
      expect(result!.group_name).toBe('CONSUMABLE');
      expect(result!.generated_by_rule).toBe('R6');
      expect(result!.unit_label).toBe('sqm');
    });

    it('COVE_LIGHT + HIGH (15mm board) on 6,480,000 sqmm → 6.48 sqm', () => {
      // Formula-derived: 6480000/1000000 = 6.48 sqm
      // (thickness affects WHICH SKU is used, not the quantity formula)
      const result = computeStructuralBoardLineItem({
        total_board_thickness_mm: 15,
        net_area_sqmm: 6480000,
        ...BASE_BOARD_SKU,
      });

      expect(result).not.toBeNull();
      expect(result!.quantity).toBeCloseTo(6.48);
    });

    it('PROFILE_LIGHT + DRY (5mm board) on 8,100,000 sqmm → 8.1 sqm', () => {
      // Formula-derived: 8100000/1000000 = 8.1 sqm
      const result = computeStructuralBoardLineItem({
        total_board_thickness_mm: 5,
        net_area_sqmm: 8100000,
        ...BASE_BOARD_SKU,
      });

      expect(result).not.toBeNull();
      expect(result!.quantity).toBeCloseTo(8.1);
    });

    it('NONE + HIGH (5mm moisture board only) → still produces line item', () => {
      // Even without lighting, HIGH moisture requires a board (R3 adds 5mm)
      // Formula-derived: 9720000/1000000 = 9.72 sqm
      const result = computeStructuralBoardLineItem({
        total_board_thickness_mm: 5,
        net_area_sqmm: 9720000,
        ...BASE_BOARD_SKU,
      });

      expect(result).not.toBeNull();
      expect(result!.quantity).toBeCloseTo(9.72);
    });
  });

  describe('No board needed (thickness = 0)', () => {
    it('NONE + DRY (0mm) → returns null (no line item)', () => {
      // No lighting + no moisture = no base board
      const result = computeStructuralBoardLineItem({
        total_board_thickness_mm: 0,
        net_area_sqmm: 9720000,
        ...BASE_BOARD_SKU,
      });

      expect(result).toBeNull();
    });

    it('NONE + AMBIENT (0mm) → returns null', () => {
      const result = computeStructuralBoardLineItem({
        total_board_thickness_mm: 0,
        net_area_sqmm: 8100000,
        ...BASE_BOARD_SKU,
      });

      expect(result).toBeNull();
    });
  });

  describe('Regression fixture spaces', () => {
    it('Space 1: TV_UNIT_WALL COVE_LIGHT/PREMIUM/DRY → board needed, 9.72 sqm', () => {
      // Space 1: 3600×2700 STRAIGHT, COVE_LIGHT → R2=10mm, moisture not HIGH → R3=0
      // total = 10mm, net_area = 9,720,000 → 9.72 sqm
      const result = computeStructuralBoardLineItem({
        total_board_thickness_mm: 10,
        net_area_sqmm: 9720000,
        ...BASE_BOARD_SKU,
      });
      expect(result).not.toBeNull();
      expect(result!.quantity).toBeCloseTo(9.72);
    });

    it('Space 2: BED_BACK_WALL NONE/PREMIUM/DRY → no board', () => {
      // Space 2: NONE lighting → R2=0, not HIGH → R3=0, total=0
      const result = computeStructuralBoardLineItem({
        total_board_thickness_mm: 0,
        net_area_sqmm: 8100000,
        ...BASE_BOARD_SKU,
      });
      expect(result).toBeNull();
    });

    it('Space 3: BATHROOM_WALL NONE/STANDARD/HIGH → moisture board, 6.48 sqm', () => {
      // Space 3: NONE lighting → R2=0, HIGH moisture → R3=+5mm, total=5
      // net_area = 6,480,000 → 6.48 sqm
      const result = computeStructuralBoardLineItem({
        total_board_thickness_mm: 5,
        net_area_sqmm: 6480000,
        ...BASE_BOARD_SKU,
      });
      expect(result).not.toBeNull();
      expect(result!.quantity).toBeCloseTo(6.48);
    });
  });
});
