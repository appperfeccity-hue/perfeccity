/**
 * Rule R2 — Base Board Thickness
 * Source: Part 8, Configuration Engine rules
 * 
 * Logic:
 * - lighting_type = NONE → 0mm (no base board needed)
 * - lighting_type = PROFILE_LIGHT → 5mm
 * - lighting_type = COVE_LIGHT → 10mm
 * 
 * This is a fixed-value lookup. No spec-interpretation needed.
 */

import { LightingType } from './r1-installation-type';

/**
 * Determine base board thickness from lighting type.
 * Part 8 R2: "NONE→0mm, PROFILE_LIGHT→5mm, COVE_LIGHT→10mm"
 */
export function determineBaseBoardThickness(lightingType: LightingType): number {
  switch (lightingType) {
    case 'NONE':
      return 0;
    case 'PROFILE_LIGHT':
      return 5;
    case 'COVE_LIGHT':
      return 10;
    default:
      throw new Error(`R2: Unknown lighting_type: ${lightingType}`);
  }
}
