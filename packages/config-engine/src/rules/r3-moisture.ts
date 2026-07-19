/**
 * Rule R3 — Moisture-Resistant Base Board Addition
 * Source: Part 8, Configuration Engine rules
 * 
 * Logic:
 * - moisture_level = HIGH → +5mm moisture-resistant base board (stacks with R2)
 * - moisture_level = DRY or AMBIENT → no addition (0mm)
 * 
 * Stacking: R3's 5mm adds to R2's thickness.
 * Example: COVE_LIGHT (R2=10mm) + HIGH moisture (R3=+5mm) = 15mm total base board.
 * 
 * No spec-interpretation needed (explicit conditional).
 */

export type MoistureLevel = 'DRY' | 'AMBIENT' | 'HIGH';

/**
 * Determine moisture addition to base board thickness.
 * Part 8 R3: "moisture_level=HIGH → +5mm moisture-resistant base board (stacks with R2)"
 */
export function determineMoistureAddition(moistureLevel: MoistureLevel): number {
  switch (moistureLevel) {
    case 'HIGH':
      return 5;
    case 'DRY':
    case 'AMBIENT':
      return 0;
    default:
      throw new Error(`R3: Unknown moisture_level: ${moistureLevel}`);
  }
}

/**
 * Compute total base board thickness (R2 + R3 combined).
 * This is the convenience function that most callers will use.
 */
export function computeTotalBaseBoardThickness(
  r2Thickness: number,
  moistureLevel: MoistureLevel
): number {
  return r2Thickness + determineMoistureAddition(moistureLevel);
}
