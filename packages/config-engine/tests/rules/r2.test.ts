/**
 * Rule R2 Tests — Base Board Thickness
 * Fixed-value lookup, all values tested.
 * Formula-derived (no interpretation needed).
 */

import { describe, it, expect } from 'vitest';
import { determineBaseBoardThickness } from '../../src/rules/r2-base-board';

describe('R2: determineBaseBoardThickness', () => {
  it('NONE → 0mm', () => {
    // Part 8 R2: "NONE→0mm"
    expect(determineBaseBoardThickness('NONE')).toBe(0);
  });

  it('PROFILE_LIGHT → 5mm', () => {
    // Part 8 R2: "PROFILE_LIGHT→5mm"
    expect(determineBaseBoardThickness('PROFILE_LIGHT')).toBe(5);
  });

  it('COVE_LIGHT → 10mm', () => {
    // Part 8 R2: "COVE_LIGHT→10mm"
    expect(determineBaseBoardThickness('COVE_LIGHT')).toBe(10);
  });

  it('throws on unknown lighting_type', () => {
    expect(() => determineBaseBoardThickness('HALOGEN' as any)).toThrow('R2: Unknown lighting_type');
  });
});
