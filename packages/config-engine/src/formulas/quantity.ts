/**
 * Quantity Formulas — Part 8 (frozen)
 * 
 * PER_PANEL = CEIL(net_area_sqmm / (width_mm × height_mm)) — CEIL mandatory, never ROUND/FLOOR
 * PER_SQM = net_area_sqmm / 1,000,000 (convert sqmm to sqm) × factor
 * PER_RFT_PERIMETER = 2(width_mm + height_mm) / 304.8 × factor
 * PER_RFT_HEIGHT = height_mm / 1000 × factor
 * FIXED_PER_SPACE = literal quantity (1 per space)
 * FIXED_PER_PROJECT = literal quantity (1 per project, not per space)
 * 
 * Source: Part 8, Part 3 (SKU category quantity formulas)
 * All formulas operate on integers (paise/sqmm) except where unit conversion needed.
 */

/**
 * PER_PANEL: CEIL(net_area_sqmm / (panel_width_mm × panel_height_mm))
 * 
 * CEIL mandatory — never ROUND/FLOOR (Part 8, Part 10 unit test requirement).
 * Source: product_library.width_mm / height_mm (v7.0 numeric fields).
 * 
 * @param net_area_sqmm - Net wall area in square millimeters (must be > 0)
 * @param panel_width_mm - Panel width from product_library.width_mm
 * @param panel_height_mm - Panel height from product_library.height_mm
 * @returns Number of panels needed (always integer, always rounds UP)
 */
export function computePanelQuantity(
  net_area_sqmm: number,
  panel_width_mm: number,
  panel_height_mm: number
): number {
  if (net_area_sqmm <= 0) {
    throw new Error('INVALID_NET_AREA: net_area_sqmm must be > 0');
  }
  if (panel_width_mm <= 0 || panel_height_mm <= 0) {
    throw new Error('INVALID_PANEL_DIMENSIONS: width_mm and height_mm must be > 0');
  }

  const panelArea = panel_width_mm * panel_height_mm;
  return Math.ceil(net_area_sqmm / panelArea);
}

/**
 * PER_SQM: quantity based on area in square meters.
 * Converts sqmm to sqm (÷ 1,000,000), then multiplies by factor.
 * Used for consumables like adhesive, base board, moisture backing.
 * 
 * @param net_area_sqmm - Net area in square millimeters
 * @param factor - Multiplier (default 1.0, e.g., 1.0 for "1 unit per sqm")
 * @returns Quantity (decimal — caller decides whether to CEIL for ordering)
 */
export function computePerSqm(
  net_area_sqmm: number,
  factor: number = 1.0
): number {
  if (net_area_sqmm <= 0) {
    throw new Error('INVALID_NET_AREA: net_area_sqmm must be > 0');
  }
  const area_sqm = net_area_sqmm / 1_000_000;
  return area_sqm * factor;
}

/**
 * PER_RFT_PERIMETER: running feet based on wall perimeter.
 * Formula: 2(width_mm + height_mm) / 304.8 × factor
 * 304.8mm = 1 foot (conversion from mm to feet).
 * Used for trims that run along the wall perimeter.
 * 
 * @param width_mm - Wall width in mm
 * @param height_mm - Wall height in mm
 * @param factor - Multiplier (default 1.0)
 * @returns Quantity in running feet (decimal)
 */
export function computePerRftPerimeter(
  width_mm: number,
  height_mm: number,
  factor: number = 1.0
): number {
  if (width_mm <= 0 || height_mm <= 0) {
    throw new Error('INVALID_DIMENSIONS: width_mm and height_mm must be > 0');
  }
  const perimeter_mm = 2 * (width_mm + height_mm);
  const perimeter_rft = perimeter_mm / 304.8;
  return perimeter_rft * factor;
}

/**
 * PER_RFT_HEIGHT: running feet based on wall height only.
 * Formula: height_mm / 1000 × factor
 * Note: This divides by 1000 (mm to meters), not 304.8 (mm to feet).
 * 
 * SPEC-INTERPRETATION NOTE: Part 8 states "PER_RFT_HEIGHT = height_mm/1000 × factor"
 * The name says "RFT" (running feet) but the formula divides by 1000 (meters).
 * This is taken literally from the spec — the formula as stated is what's implemented.
 * If "1000" should be "304.8" (actual mm-to-feet conversion), this is a spec error
 * that needs correction, not a code fix.
 * 
 * [SI-2 — see note below about whether /1000 or /304.8 is correct]
 * 
 * @param height_mm - Wall height in mm
 * @param factor - Multiplier (default 1.0)
 * @returns Quantity (decimal)
 */
export function computePerRftHeight(
  height_mm: number,
  factor: number = 1.0
): number {
  if (height_mm <= 0) {
    throw new Error('INVALID_DIMENSIONS: height_mm must be > 0');
  }
  // Part 8 literal: height_mm / 1000 × factor
  // NOT height_mm / 304.8 — even though the name says "RFT"
  return (height_mm / 1000) * factor;
}

/**
 * FIXED_PER_SPACE: literal fixed quantity, once per space.
 * Used for lighting kits (one per space regardless of area).
 * 
 * @param quantity - The fixed quantity (typically 1)
 * @returns The same quantity (identity function, but named for clarity in BOM generation)
 */
export function computeFixedPerSpace(quantity: number = 1): number {
  return quantity;
}

/**
 * FIXED_PER_PROJECT: literal fixed quantity, once per project (not per space).
 * Used for transport costs (flat rate per project).
 * 
 * @param quantity - The fixed quantity (typically 1)
 * @returns The same quantity
 */
export function computeFixedPerProject(quantity: number = 1): number {
  return quantity;
}
