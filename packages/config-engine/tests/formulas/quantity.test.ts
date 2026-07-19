/**
 * Quantity Formula Tests — Part 8 (frozen formulas)
 * 
 * ACTUALLY EXECUTED — not placeholders.
 * Every fixture shows its derivation inline.
 */

import { describe, it, expect } from 'vitest';
import {
  computePanelQuantity,
  computePerSqm,
  computePerRftPerimeter,
  computePerRftHeight,
  computeFixedPerSpace,
  computeFixedPerProject,
} from '../../src/formulas/quantity';

describe('computePanelQuantity (PER_PANEL = CEIL)', () => {
  it('regression fixture space 1: TV_UNIT_WALL 3600×2700, WPC Oak 200×2700 → 18 panels', () => {
    // Formula-derived:
    // net_area = 3600 × 2700 = 9,720,000 sqmm
    // panel_area = 200 × 2700 = 540,000 sqmm
    // CEIL(9,720,000 / 540,000) = CEIL(18.0) = 18
    expect(computePanelQuantity(9720000, 200, 2700)).toBe(18);
  });

  it('regression fixture space 2: BED_BACK_WALL 3000×2700, WPC Oak 200×2700 → 15 panels', () => {
    // Formula-derived:
    // net_area = 3000 × 2700 = 8,100,000 sqmm
    // panel_area = 200 × 2700 = 540,000 sqmm
    // CEIL(8,100,000 / 540,000) = CEIL(15.0) = 15
    expect(computePanelQuantity(8100000, 200, 2700)).toBe(15);
  });

  it('regression fixture space 3: BATHROOM_WALL 2400×2700, PVC 200×2700 → 12 panels', () => {
    // Formula-derived:
    // net_area = 2400 × 2700 = 6,480,000 sqmm
    // panel_area = 200 × 2700 = 540,000 sqmm
    // CEIL(6,480,000 / 540,000) = CEIL(12.0) = 12
    expect(computePanelQuantity(6480000, 200, 2700)).toBe(12);
  });

  it('UV_MARBLE 600×1200 panel on 3600×2700 wall → 14 panels', () => {
    // Formula-derived:
    // net_area = 9,720,000 sqmm
    // panel_area = 600 × 1200 = 720,000 sqmm
    // CEIL(9,720,000 / 720,000) = CEIL(13.5) = 14
    expect(computePanelQuantity(9720000, 600, 1200)).toBe(14);
  });

  it('CEIL ensures rounding UP: 13.0001 → 14', () => {
    // Formula-derived:
    // area just barely exceeds 13 panels worth
    // 13 × 540,000 = 7,020,000. area = 7,020,001 → CEIL(7020001/540000) = CEIL(13.000002) = 14
    expect(computePanelQuantity(7020001, 200, 2700)).toBe(14);
  });

  it('exactly divisible: 13 × 540,000 = 7,020,000 → 13 (not 14)', () => {
    // Formula-derived:
    // CEIL(7,020,000 / 540,000) = CEIL(13.0) = 13
    // No off-by-one: exact division does NOT round up
    expect(computePanelQuantity(7020000, 200, 2700)).toBe(13);
  });

  it('small area: 1 sqmm with 200×2700 panel → 1 panel', () => {
    // CEIL(1 / 540000) = CEIL(0.0000018...) = 1
    expect(computePanelQuantity(1, 200, 2700)).toBe(1);
  });

  it('throws on net_area <= 0', () => {
    expect(() => computePanelQuantity(0, 200, 2700)).toThrow('INVALID_NET_AREA');
    expect(() => computePanelQuantity(-1, 200, 2700)).toThrow('INVALID_NET_AREA');
  });

  it('throws on panel dimensions <= 0', () => {
    expect(() => computePanelQuantity(9720000, 0, 2700)).toThrow('INVALID_PANEL_DIMENSIONS');
    expect(() => computePanelQuantity(9720000, 200, 0)).toThrow('INVALID_PANEL_DIMENSIONS');
  });
});

describe('computePerSqm', () => {
  it('9,720,000 sqmm = 9.72 sqm → factor 1.0 = 9.72', () => {
    // Formula-derived: 9720000 / 1000000 = 9.72
    expect(computePerSqm(9720000)).toBeCloseTo(9.72);
  });

  it('6,480,000 sqmm with factor 1.5 = 9.72', () => {
    // Formula-derived: 6480000 / 1000000 × 1.5 = 6.48 × 1.5 = 9.72
    expect(computePerSqm(6480000, 1.5)).toBeCloseTo(9.72);
  });

  it('throws on net_area <= 0', () => {
    expect(() => computePerSqm(0)).toThrow('INVALID_NET_AREA');
  });
});

describe('computePerRftPerimeter', () => {
  it('3600×2700 wall: perimeter = 12600mm = 41.34 rft', () => {
    // Formula-derived: 2(3600+2700) = 12,600mm. 12600/304.8 = 41.3386...
    expect(computePerRftPerimeter(3600, 2700)).toBeCloseTo(41.3386, 2);
  });

  it('3000×2700 wall: perimeter = 11400mm = 37.40 rft', () => {
    // Formula-derived: 2(3000+2700) = 11,400mm. 11400/304.8 = 37.4016...
    expect(computePerRftPerimeter(3000, 2700)).toBeCloseTo(37.4016, 2);
  });

  it('with factor 2.0: doubled', () => {
    // Formula-derived: 41.3386 × 2 = 82.677
    expect(computePerRftPerimeter(3600, 2700, 2.0)).toBeCloseTo(82.677, 1);
  });

  it('throws on dimensions <= 0', () => {
    expect(() => computePerRftPerimeter(0, 2700)).toThrow('INVALID_DIMENSIONS');
  });
});

describe('computePerRftHeight', () => {
  it('[SI-2 PENDING] 2700mm height: 2700/1000 = 2.7', () => {
    // SPEC-INTERPRETATION [SI-2]: Part 8 states "PER_RFT_HEIGHT = height_mm/1000 × factor"
    // The name says "RFT" (running feet) but divides by 1000 (meters), not 304.8 (feet).
    // Implemented literally from spec. If /304.8 is intended, result would be 8.858.
    // STATUS: PENDING — needs Akshay confirmation.
    // Current implementation: /1000 (spec literal)
    expect(computePerRftHeight(2700)).toBeCloseTo(2.7);
  });

  it('[SI-2 PENDING] with factor 1.5: 2700/1000 × 1.5 = 4.05', () => {
    // SPEC-INTERPRETATION [SI-2]: same pending decision
    expect(computePerRftHeight(2700, 1.5)).toBeCloseTo(4.05);
  });

  it('throws on height <= 0', () => {
    expect(() => computePerRftHeight(0)).toThrow('INVALID_DIMENSIONS');
  });
});

describe('computeFixedPerSpace', () => {
  it('default = 1', () => {
    expect(computeFixedPerSpace()).toBe(1);
  });

  it('explicit quantity = 2', () => {
    expect(computeFixedPerSpace(2)).toBe(2);
  });
});

describe('computeFixedPerProject', () => {
  it('default = 1', () => {
    expect(computeFixedPerProject()).toBe(1);
  });
});
