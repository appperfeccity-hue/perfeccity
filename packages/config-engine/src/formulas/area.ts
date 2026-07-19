/**
 * Area Formulas — Part 8 (frozen)
 * 
 * Three wall shapes with specific formulas:
 * - STRAIGHT: width_mm × height_mm
 * - L_SHAPE: (width_mm × height_mm) + (segment_b_mm × height_mm)
 * - C_SHAPE: (width_mm × height_mm) + (segment_b_mm × height_mm) + (segment_c_mm × height_mm)
 * 
 * net_area_sqmm = gross_area_sqmm − opening_deduction_sqmm (must be > 0)
 * 
 * These formulas are shared by the Configuration Engine (Sprint 4) and
 * the Quotation Engine (Sprint 5) — same formula, not recomputed differently.
 */

export type WallShape = 'STRAIGHT' | 'L_SHAPE' | 'C_SHAPE';

export interface AreaInput {
  wall_shape: WallShape;
  width_mm: number;
  height_mm: number;
  segment_b_mm?: number | null;
  segment_c_mm?: number | null;
  opening_deduction_sqmm?: number | null;
}

export interface AreaResult {
  gross_area_sqmm: number;
  net_area_sqmm: number;
  opening_deduction_sqmm: number;
}

/**
 * Compute gross area based on wall shape.
 * Source: Part 8, frozen area formula table.
 */
export function computeGrossArea(
  wall_shape: WallShape,
  width_mm: number,
  height_mm: number,
  segment_b_mm?: number | null,
  segment_c_mm?: number | null,
): number {
  switch (wall_shape) {
    case 'STRAIGHT':
      return width_mm * height_mm;

    case 'L_SHAPE':
      // Formula: (width_mm × height_mm) + (segment_b_mm × height_mm)
      // SI-1: segment_b_mm=0 is accepted (adds 0). segment_b_mm=null treated as 0.
      return (width_mm * height_mm) + ((segment_b_mm ?? 0) * height_mm);

    case 'C_SHAPE':
      // Formula: (width_mm × height_mm) + (segment_b_mm × height_mm) + (segment_c_mm × height_mm)
      return (width_mm * height_mm)
        + ((segment_b_mm ?? 0) * height_mm)
        + ((segment_c_mm ?? 0) * height_mm);

    default:
      throw new Error(`Unknown wall_shape: ${wall_shape}`);
  }
}

/**
 * Compute net area (gross minus deductions).
 * Throws if net_area ≤ 0 (spec: 422 INVALID_NET_AREA).
 */
export function computeNetArea(
  gross_area_sqmm: number,
  opening_deduction_sqmm: number | null | undefined,
): number {
  const deduction = opening_deduction_sqmm ?? 0;
  const net = gross_area_sqmm - deduction;

  if (net <= 0) {
    throw new Error(
      `INVALID_NET_AREA: net_area_sqmm (${net}) must be > 0. ` +
      `gross=${gross_area_sqmm}, deduction=${deduction}`
    );
  }

  return net;
}

/**
 * Compute full area result (gross + net) from input measurements.
 */
export function computeArea(input: AreaInput): AreaResult {
  const gross_area_sqmm = computeGrossArea(
    input.wall_shape,
    input.width_mm,
    input.height_mm,
    input.segment_b_mm,
    input.segment_c_mm,
  );

  const deduction = input.opening_deduction_sqmm ?? 0;
  const net_area_sqmm = computeNetArea(gross_area_sqmm, deduction);

  return {
    gross_area_sqmm,
    net_area_sqmm,
    opening_deduction_sqmm: deduction,
  };
}
