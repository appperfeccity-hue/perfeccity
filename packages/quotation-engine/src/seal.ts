/**
 * computeQuotationSeal — Sprint 5 T3
 *
 * SEPARATE function from computeConfigurationHash (Part 8 explicit instruction):
 * "Don't build one shared utility for both — a boolean flag is exactly the kind
 * of parameter that gets passed wrong once."
 *
 * Key differences from computeConfigurationHash:
 * - Timestamps INCLUDED (configuration_hash excludes them)
 * - Payload keys: generated_at, grand_total_paise, project_id, snapshot_id,
 *   step_breakdown, version (alphabetical per Part 8)
 * - Purpose: seal a specific quotation snapshot at a point in time
 *   (configuration_hash answers "is this the same configuration?")
 *
 * Serialization rules (same as configuration_hash — Part 8 canonical rules):
 * - UTF-8 encoding
 * - Keys sorted alphabetically, recursively, at every nesting level
 * - No whitespace between tokens
 * - Numbers as JSON numbers (never strings)
 * - null fields OMITTED entirely
 *
 * Design choice (AD-28): Plain SHA-256, not HMAC.
 * The seal is independently auditable from stored seal_payload without any secret.
 */

import { StepBreakdown } from './types';

export interface SealInput {
  generated_at: string;       // ISO-8601 timestamp
  grand_total_paise: number;  // integer (AD-31 guaranteed)
  project_id: string;         // UUID
  snapshot_id: string;        // UUID
  step_breakdown: StepBreakdown;
  version: string;            // engine version, e.g. '1.0.0'
}

export interface SealOutput {
  seal_payload: string;   // the exact canonical JSON that was hashed
  sha256_hash: string;    // hex-encoded SHA-256 of seal_payload
}

/**
 * Compute the quotation seal (SHA-256 of canonical seal_payload).
 *
 * Returns BOTH the canonical JSON (for storage in seal_payload column)
 * and the hex hash (for storage in sha256_hash column).
 *
 * The acceptance test (T5) will read ONLY seal_payload from the DB,
 * re-canonicalize it, re-hash, and verify it matches sha256_hash.
 */
export async function computeQuotationSeal(input: SealInput): Promise<SealOutput> {
  // Build the payload object with alphabetical keys (per Part 8)
  // Note: the keys are already listed alphabetically in the spec:
  // generated_at, grand_total_paise, project_id, snapshot_id, step_breakdown, version
  const payloadObj = {
    generated_at: input.generated_at,
    grand_total_paise: input.grand_total_paise,
    project_id: input.project_id,
    snapshot_id: input.snapshot_id,
    step_breakdown: input.step_breakdown,
    version: input.version,
  };

  // Canonicalize (sorted keys, no whitespace, null omitted, recursive)
  const seal_payload = canonicalizeSeal(payloadObj);

  // SHA-256 hash
  const encoded = new TextEncoder().encode(seal_payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const sha256_hash = bytesToHex(new Uint8Array(hashBuffer));

  return { seal_payload, sha256_hash };
}

/**
 * Canonical JSON serialization for quotation seal (Part 8 rules).
 * SEPARATE implementation from config-engine's canonicalize (Part 8 explicit).
 *
 * Rules:
 * - Keys sorted alphabetically at every nesting level
 * - No whitespace between tokens
 * - null/undefined fields omitted entirely
 * - Numbers as numbers, strings as strings
 */
function canonicalizeSeal(obj: unknown): string {
  if (obj === null || obj === undefined) {
    return '';
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return JSON.stringify(obj);
  }

  if (typeof obj === 'string') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    const elements = obj.map(item => canonicalizeSeal(item));
    return '[' + elements.join(',') + ']';
  }

  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    const pairs: string[] = [];

    for (const key of keys) {
      const value = (obj as Record<string, unknown>)[key];
      if (value === null || value === undefined) {
        continue;
      }
      pairs.push(JSON.stringify(key) + ':' + canonicalizeSeal(value));
    }

    return '{' + pairs.join(',') + '}';
  }

  return JSON.stringify(obj);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
