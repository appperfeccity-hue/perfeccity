/**
 * Configuration Hash — R8
 * 
 * SHA-256 hash of canonical sorted JSON of configuration line items.
 * See Part 8 "Canonical Serialization & Hashing Rules" for the full discipline.
 * 
 * IMPORTANT: This is a SEPARATE function from computeQuotationSeal.
 * Do NOT build a shared utility with a boolean flag — two narrowly-named
 * functions, each hard-coding its own field list, per spec instruction.
 * 
 * Inputs (frozen):
 * - template_id
 * - All measurement fields (width_mm, height_mm, segment_b_mm, segment_c_mm,
 *   opening_deduction_sqmm, gross_area_sqmm, net_area_sqmm)
 * - Every configuration_line_items row (sku, quantity, unit_label, product_role, group_name)
 * - Every configured_furniture row (sku, quantity, default_position, colour_variant)
 * - Every auto-added consumable from R6/R7
 * 
 * Rules:
 * - UTF-8 encoding
 * - Canonical JSON (keys sorted alphabetically, recursively)
 * - No whitespace between tokens
 * - Decimals as JSON numbers, never strings
 * - All _paise fields as integers (no floating point)
 * - null fields OMITTED entirely (never serialized as null)
 * - Timestamps EXCLUDED (this hash answers "is this the same configuration")
 */
export function computeConfigurationHash(_input: unknown): string {
  // Implementation in Sprint 4
  throw new Error('Not implemented — Sprint 4');
}
