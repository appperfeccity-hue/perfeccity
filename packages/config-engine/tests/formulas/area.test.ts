/**
 * Area Formula Tests — Part 8 (frozen formulas)
 * 
 * ACTUALLY EXECUTED — not placeholders.
 * Every fixture shows its derivation inline.
 * Spec-interpretation fixtures flagged with [SI-N] markers.
 */

import { describe, it, expect } from 'vitest';
import { computeGrossArea, computeNetArea, computeArea } from '../../src/formulas/area';

describe('computeGrossArea', () => {
  describe('STRAIGHT', () => {
    it('3600×2700 = 9,720,000 sqmm', () => {
      // Formula-derived: 3600 × 2700 = 9,720,000
      expect(computeGrossArea('STRAIGHT', 3600, 2700)).toBe(9720000);
    });

    it('3000×2700 = 8,100,000 sqmm', () => {
      // Formula-derived: 3000 × 2700 = 8,100,000
      expect(computeGrossArea('STRAIGHT', 3000, 2700)).toBe(8100000);
    });

    it('2400×2700 = 6,480,000 sqmm', () => {
      // Formula-derived: 2400 × 2700 = 6,480,000
      expect(computeGrossArea('STRAIGHT', 2400, 2700)).toBe(6480000);
    });

    it('ignores segment_b_mm and segment_c_mm for STRAIGHT', () => {
      // Part 8: segment_b_mm/segment_c_mm are null/unused for STRAIGHT
      expect(computeGrossArea('STRAIGHT', 3000, 2700, 500, 300)).toBe(8100000);
    });
  });

  describe('L_SHAPE', () => {
    it('3000×2700 + 1200×2700 = 11,340,000 sqmm', () => {
      // Formula-derived: (3000×2700) + (1200×2700) = 8,100,000 + 3,240,000 = 11,340,000
      expect(computeGrossArea('L_SHAPE', 3000, 2700, 1200)).toBe(11340000);
    });

    it('2400×2700 + 800×2700 = 8,640,000 sqmm', () => {
      // Formula-derived: (2400×2700) + (800×2700) = 6,480,000 + 2,160,000 = 8,640,000
      expect(computeGrossArea('L_SHAPE', 2400, 2700, 800)).toBe(8640000);
    });

    it('[SI-1 PENDING] segment_b_mm=0 produces same as STRAIGHT', () => {
      // SPEC-INTERPRETATION [SI-1]: Part 8 formula is (w×h) + (segment_b×h).
      // With segment_b=0: (3000×2700) + (0×2700) = 8,100,000 + 0 = 8,100,000
      // Assumption: 0 is valid input (not rejected). A wall expressed as L_SHAPE
      // with zero-length second segment is geometrically straight.
      // STATUS: PENDING Akshay confirmation (Option A vs B).
      // FLAG: If Option B is chosen, this test should REJECT 0 instead of accepting it.
      expect(computeGrossArea('L_SHAPE', 3000, 2700, 0)).toBe(8100000);
    });

    it('[SI-1 PENDING] segment_b_mm=null treated as 0', () => {
      // SPEC-INTERPRETATION [SI-1]: null treated as 0 for L_SHAPE.
      // Assumption: null is valid (same reasoning as segment_b=0).
      // STATUS: PENDING — same decision as SI-1 above.
      expect(computeGrossArea('L_SHAPE', 3000, 2700, null)).toBe(8100000);
    });

    it('ignores segment_c_mm for L_SHAPE', () => {
      // Part 8: "segment_c_mm is null/unused for L_SHAPE"
      expect(computeGrossArea('L_SHAPE', 3000, 2700, 1200, 999)).toBe(11340000);
    });
  });

  describe('C_SHAPE', () => {
    it('3000×2700 + 1200×2700 + 900×2700 = 13,770,000 sqmm', () => {
      // Formula-derived: (3000×2700) + (1200×2700) + (900×2700)
      // = 8,100,000 + 3,240,000 + 2,430,000 = 13,770,000
      expect(computeGrossArea('C_SHAPE', 3000, 2700, 1200, 900)).toBe(13770000);
    });

    it('handles null segments as 0 for C_SHAPE', () => {
      // segment_b=null, segment_c=null → same as STRAIGHT
      expect(computeGrossArea('C_SHAPE', 3000, 2700, null, null)).toBe(8100000);
    });
  });

  describe('Invalid input', () => {
    it('throws on unknown wall_shape', () => {
      expect(() => computeGrossArea('HEXAGON' as any, 3000, 2700)).toThrow('Unknown wall_shape');
    });
  });
});

describe('computeNetArea', () => {
  it('gross minus deduction', () => {
    // Formula-derived: 9,720,000 - 500,000 = 9,220,000
    expect(computeNetArea(9720000, 500000)).toBe(9220000);
  });

  it('null deduction treated as 0', () => {
    expect(computeNetArea(9720000, null)).toBe(9720000);
  });

  it('undefined deduction treated as 0', () => {
    expect(computeNetArea(9720000, undefined)).toBe(9720000);
  });

  it('throws INVALID_NET_AREA when deduction >= gross', () => {
    // Part 8: "must be > 0 else 422 INVALID_NET_AREA"
    expect(() => computeNetArea(9720000, 9720000)).toThrow('INVALID_NET_AREA');
  });

  it('throws INVALID_NET_AREA when deduction > gross', () => {
    expect(() => computeNetArea(9720000, 10000000)).toThrow('INVALID_NET_AREA');
  });

  it('net_area=1 is valid (exactly > 0)', () => {
    expect(computeNetArea(9720000, 9719999)).toBe(1);
  });
});

describe('computeArea (integration)', () => {
  it('STRAIGHT 3600×2700 with 500000 deduction', () => {
    // gross = 3600×2700 = 9,720,000
    // net = 9,720,000 - 500,000 = 9,220,000
    const result = computeArea({
      wall_shape: 'STRAIGHT',
      width_mm: 3600,
      height_mm: 2700,
      opening_deduction_sqmm: 500000,
    });

    expect(result.gross_area_sqmm).toBe(9720000);
    expect(result.net_area_sqmm).toBe(9220000);
    expect(result.opening_deduction_sqmm).toBe(500000);
  });

  it('regression fixture space 1: TV_UNIT_WALL 3600×2700 STRAIGHT, no deduction', () => {
    // Part 8 regression fixture: TV_UNIT_WALL 3600×2700 STRAIGHT
    // gross = 3600×2700 = 9,720,000
    // deduction = 0
    // net = 9,720,000
    const result = computeArea({
      wall_shape: 'STRAIGHT',
      width_mm: 3600,
      height_mm: 2700,
    });

    expect(result.gross_area_sqmm).toBe(9720000);
    expect(result.net_area_sqmm).toBe(9720000);
  });

  it('regression fixture space 2: BED_BACK_WALL 3000×2700 STRAIGHT', () => {
    const result = computeArea({
      wall_shape: 'STRAIGHT',
      width_mm: 3000,
      height_mm: 2700,
    });

    expect(result.gross_area_sqmm).toBe(8100000);
    expect(result.net_area_sqmm).toBe(8100000);
  });

  it('regression fixture space 3: BATHROOM_WALL 2400×2700 STRAIGHT', () => {
    const result = computeArea({
      wall_shape: 'STRAIGHT',
      width_mm: 2400,
      height_mm: 2700,
    });

    expect(result.gross_area_sqmm).toBe(6480000);
    expect(result.net_area_sqmm).toBe(6480000);
  });
});
