/**
 * Quotation Seal — SHA-256
 * 
 * See Part 8 "Canonical Serialization & Hashing Rules" for the full discipline.
 * 
 * IMPORTANT: This is a SEPARATE function from computeConfigurationHash.
 * Do NOT build a shared utility with a boolean flag — two narrowly-named
 * functions, each hard-coding its own field list, per spec instruction.
 * 
 * Seal payload inputs (alphabetical keys):
 * - generated_at (INCLUDED — this hash proves a specific sealing event)
 * - grand_total_paise
 * - project_id
 * - snapshot_id
 * - step_breakdown
 * - version
 * 
 * Rules:
 * - UTF-8 encoding
 * - Canonical JSON (keys sorted alphabetically, recursively)
 * - No whitespace between tokens
 * - Decimals as JSON numbers, never strings
 * - All _paise fields as integers (no floating point)
 * - null fields OMITTED entirely (never serialized as null)
 * - Timestamps INCLUDED (opposite of configuration_hash — deliberate contrast)
 */
export function computeQuotationSeal(_input: unknown): string {
  // Implementation in Sprint 5
  throw new Error('Not implemented — Sprint 5');
}
