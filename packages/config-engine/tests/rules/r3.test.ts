/**
 * Rule R3 Tests — Moisture-Resistant Base Board Addition
 * Conditional addition (stacks with R2).
 * Formula-derived (explicit values from spec).
 */

import { describe, it, expect } from 'vitest';
import { determineMoistureAddition, computeTotalBaseBoardThickness } from '../../src/rules/r3-moisture';

describe('R3: determineMoistureAddition', () => {
  it('HIGH → +5mm', () => {
    // Part 8 R3: "moisture_level=HIGH → +5mm"
    expect(determineMoistureAddition('HIGH')).toBe(5);
  });

  it('AMBIENT → 0mm (no addition)', () => {
    expect(determineMoistureAddition('AMBIENT')).toBe(0);
  });

  it('DRY → 0mm (no addition)', () => {
    expect(determineMoistureAddition('DRY')).toBe(0);
  });

  it('throws on unknown moisture_level', () => {
    expect(() => determineMoistureAddition('DAMP' as any)).toThrow('R3: Unknown moisture_level');
  });
});

describe('R2+R3: computeTotalBaseBoardThickness (stacking)', () => {
  it('COVE_LIGHT (10mm) + HIGH moisture (+5mm) = 15mm', () => {
    // Part 8: "stacks with R2" — COVE gives 10, moisture HIGH adds 5
    expect(computeTotalBaseBoardThickness(10, 'HIGH')).toBe(15);
  });

  it('PROFILE_LIGHT (5mm) + HIGH moisture (+5mm) = 10mm', () => {
    expect(computeTotalBaseBoardThickness(5, 'HIGH')).toBe(10);
  });

  it('NONE (0mm) + HIGH moisture (+5mm) = 5mm', () => {
    // Even without lighting, HIGH moisture requires 5mm base board
    expect(computeTotalBaseBoardThickness(0, 'HIGH')).toBe(5);
  });

  it('COVE_LIGHT (10mm) + DRY (0mm) = 10mm (no stacking)', () => {
    expect(computeTotalBaseBoardThickness(10, 'DRY')).toBe(10);
  });

  it('COVE_LIGHT (10mm) + AMBIENT (0mm) = 10mm (no stacking)', () => {
    expect(computeTotalBaseBoardThickness(10, 'AMBIENT')).toBe(10);
  });

  it('NONE (0mm) + DRY (0mm) = 0mm (no base board at all)', () => {
    // No lighting + no moisture = no base board needed
    expect(computeTotalBaseBoardThickness(0, 'DRY')).toBe(0);
  });

  // Full R2×R3 matrix: 3 lighting types × 3 moisture levels = 9 combinations
  // NONE/DRY=0, NONE/AMBIENT=0, NONE/HIGH=5
  // PROFILE/DRY=5, PROFILE/AMBIENT=5, PROFILE/HIGH=10
  // COVE/DRY=10, COVE/AMBIENT=10, COVE/HIGH=15
  it('full 3×3 matrix produces correct values', () => {
    const expected: [number, 'DRY' | 'AMBIENT' | 'HIGH', number][] = [
      [0, 'DRY', 0], [0, 'AMBIENT', 0], [0, 'HIGH', 5],
      [5, 'DRY', 5], [5, 'AMBIENT', 5], [5, 'HIGH', 10],
      [10, 'DRY', 10], [10, 'AMBIENT', 10], [10, 'HIGH', 15],
    ];

    for (const [r2, moisture, expectedTotal] of expected) {
      expect(computeTotalBaseBoardThickness(r2, moisture)).toBe(expectedTotal);
    }
  });
});
