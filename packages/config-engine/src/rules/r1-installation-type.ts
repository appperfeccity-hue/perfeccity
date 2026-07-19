/**
 * Rule R1 — Installation Type Determination
 * Source: Part 8, Configuration Engine rules
 * 
 * Logic:
 * - lighting_type = NONE → installation_type = DIRECT
 * - lighting_type = PROFILE_LIGHT → installation_type = FRAME_BASED
 * - lighting_type = COVE_LIGHT → installation_type = FRAME_BASED
 * 
 * This is a deterministic lookup — every input maps to exactly one output.
 * No spec-interpretation needed (complete truth table).
 */

export type LightingType = 'NONE' | 'PROFILE_LIGHT' | 'COVE_LIGHT';
export type InstallationType = 'DIRECT' | 'FRAME_BASED';

/**
 * Determine installation type from lighting type.
 * Part 8 R1: "lighting_type=NONE → installation_type=DIRECT;
 * PROFILE_LIGHT/COVE_LIGHT → FRAME_BASED"
 */
export function determineInstallationType(lightingType: LightingType): InstallationType {
  switch (lightingType) {
    case 'NONE':
      return 'DIRECT';
    case 'PROFILE_LIGHT':
    case 'COVE_LIGHT':
      return 'FRAME_BASED';
    default:
      throw new Error(`R1: Unknown lighting_type: ${lightingType}`);
  }
}
