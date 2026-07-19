/**
 * Rule R8 — Configuration Hash (SHA-256)
 * Source: Part 8, Canonical Serialization & Hashing Rules
 * 
 * Produces a deterministic SHA-256 hash of the configuration inputs.
 * Purpose: test configuration equivalence ("is this the same configuration?")
 * 
 * IMPORTANT: This is a SEPARATE function from computeQuotationSeal (Part 8 explicit).
 * "Don't build one shared utility for both — a boolean flag is exactly the kind
 * of parameter that gets passed wrong once."
 * 
 * Canonical serialization rules:
 * - UTF-8 encoding
 * - Keys sorted alphabetically, recursively, at every nesting level
 * - No whitespace between tokens
 * - Decimals as JSON numbers, never strings
 * - All _paise fields as integers (no floating point)
 * - null fields OMITTED entirely (never serialized as null)
 * - Timestamps EXCLUDED (this hash answers "same configuration", not "same event")
 * 
 * Inputs (frozen):
 * - template_id
 * - All measurement fields
 * - Every configuration_line_items row (sku, quantity, unit_label, product_role, group_name)
 * - Every configured_furniture row (sku, quantity, default_position, colour_variant)
 * - Every auto-added consumable from R6/R7
 */

export interface ConfigHashInput {
  template_id: string;
  measurements: {
    width_mm: number;
    height_mm: number;
    segment_b_mm?: number | null;
    segment_c_mm?: number | null;
    opening_deduction_sqmm?: number | null;
    gross_area_sqmm: number;
    net_area_sqmm: number;
  };
  line_items: Array<{
    sku: string;
    quantity: number;
    unit_label: string;
    product_role: string;
    group_name: string;
  }>;
  furniture: Array<{
    sku: string;
    quantity: number;
    default_position: string | null;
    colour_variant: string | null;
  }>;
}

/**
 * Compute the configuration hash (SHA-256 of canonical JSON).
 * Deterministic: same inputs → same hash, every time.
 * 
 * Uses Web Crypto API (available in Deno/Edge Functions and modern Node).
 */
export async function computeConfigurationHash(input: ConfigHashInput): Promise<string> {
  const canonical = canonicalize(input);
  const encoded = new TextEncoder().encode(canonical);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return bytesToHex(new Uint8Array(hashBuffer));
}

/**
 * Canonical JSON serialization per Part 8 rules.
 * - Keys sorted alphabetically (recursive)
 * - No whitespace
 * - null fields omitted (not serialized)
 * - Numbers as numbers (no quotes)
 */
export function canonicalize(obj: unknown): string {
  if (obj === null || obj === undefined) {
    // null/undefined → omit entirely (caller should not include these)
    return '';
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return JSON.stringify(obj);
  }

  if (typeof obj === 'string') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    // Arrays: maintain order (line_items order matters for reproducibility)
    // Sort each element's keys, but keep array order stable
    const elements = obj.map(item => canonicalize(item));
    return '[' + elements.join(',') + ']';
  }

  if (typeof obj === 'object') {
    // Objects: sort keys alphabetically, omit null/undefined values
    const keys = Object.keys(obj).sort();
    const pairs: string[] = [];

    for (const key of keys) {
      const value = (obj as Record<string, unknown>)[key];
      // Omit null/undefined fields entirely
      if (value === null || value === undefined) {
        continue;
      }
      pairs.push(JSON.stringify(key) + ':' + canonicalize(value));
    }

    return '{' + pairs.join(',') + '}';
  }

  return JSON.stringify(obj);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
