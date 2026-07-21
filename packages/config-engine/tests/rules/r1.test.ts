/**
 * Rule R1 Tests — Installation Type Determination
 * Truth table: every input combination explicitly tested.
 * Formula-derived (lookup table, no interpretation needed).
 */

import { describe, it, expect } from 'vitest';
import { determineInstallationType } from '../../src/rules/r1-installation-type';

describe('R1: determineInstallationType', () => {
  it('NONE → DIRECT', () => {
    // Part 8 R1: "lighting_type=NONE → installation_type=DIRECT"
    expect(determineInstallationType('NONE')).toBe('DIRECT');
  });

  it('PROFILE_LIGHT → FRAME_BASED', () => {
    // Part 8 R1: "PROFILE_LIGHT → FRAME_BASED"
    expect(determineInstallationType('PROFILE_LIGHT')).toBe('FRAME_BASED');
  });

  it('COVE_LIGHT → FRAME_BASED', () => {
    // Part 8 R1: "COVE_LIGHT → FRAME_BASED"
    expect(determineInstallationType('COVE_LIGHT')).toBe('FRAME_BASED');
  });

  it('throws on unknown lighting_type', () => {
    expect(() => determineInstallationType('LED_STRIP' as any)).toThrow('R1: Unknown lighting_type');
  });

  // Complete truth table — all 3 valid inputs covered above.
  // No partial/ambiguous cases exist for R1 (it's a pure lookup).
});
