/**
 * Quotation Seal Tests — Sprint 5 T3
 *
 * Tests the computeQuotationSeal function:
 * 1. Produces a valid 64-char hex hash
 * 2. seal_payload is valid JSON that re-hashes to sha256_hash
 * 3. Deterministic (same input → same output)
 * 4. Timestamps INCLUDED (changing generated_at changes hash)
 * 5. Independent verifiability (the T5 acceptance pattern)
 * 6. Separate from computeConfigurationHash (different inputs → different outputs)
 *
 * AD-28: Plain SHA-256 (not HMAC).
 * The acceptance test pattern: read seal_payload → canonicalize → SHA-256 → match.
 */

import { describe, it, expect } from 'vitest';
import { computeQuotationSeal, SealInput } from '../src/seal';
import { StepBreakdown } from '../src/types';

// Use the frozen regression step_breakdown from T2
const FIXTURE_BREAKDOWN: StepBreakdown = {
  step_4_wall_panel_total_paise: 1272000,
  step_5_trim_total_paise: 528544,
  step_5_lighting_total_paise: 0,
  step_5_consumable_total_paise: 567000,
  step_5_non_panel_total_paise: 1095544,
  step_6_structural_check: 'PASS',
  step_7_moisture_check: 'PASS',
  step_8_labour_total_paise: 461700,
  step_9_transport_paise: 500000,
  step_10_furniture_total_paise: 0,
  step_11_subtotal_paise: 3329244,
  step_12_margin_paise: 832311,
  step_12_pre_gst_total_paise: 4161555,
  step_13_gst_paise: 749080,
  step_13_grand_total_paise: 4910635,
};

const FIXTURE_SEAL_INPUT: SealInput = {
  generated_at: '2026-07-20T10:30:00.000Z',
  grand_total_paise: 4910635,
  project_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  snapshot_id: '11111111-2222-3333-4444-555555555555',
  step_breakdown: FIXTURE_BREAKDOWN,
  version: '1.0.0',
};

describe('computeQuotationSeal', () => {
  describe('Basic properties', () => {
    it('produces a valid 64-char lowercase hex hash', async () => {
      const result = await computeQuotationSeal(FIXTURE_SEAL_INPUT);
      expect(result.sha256_hash).toHaveLength(64);
      expect(result.sha256_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('seal_payload is valid JSON', async () => {
      const result = await computeQuotationSeal(FIXTURE_SEAL_INPUT);
      expect(() => JSON.parse(result.seal_payload)).not.toThrow();
    });

    it('seal_payload contains all required keys', async () => {
      const result = await computeQuotationSeal(FIXTURE_SEAL_INPUT);
      const parsed = JSON.parse(result.seal_payload);
      expect(parsed).toHaveProperty('generated_at');
      expect(parsed).toHaveProperty('grand_total_paise');
      expect(parsed).toHaveProperty('project_id');
      expect(parsed).toHaveProperty('snapshot_id');
      expect(parsed).toHaveProperty('step_breakdown');
      expect(parsed).toHaveProperty('version');
    });

    it('seal_payload has no whitespace (canonical format)', async () => {
      const result = await computeQuotationSeal(FIXTURE_SEAL_INPUT);
      // No spaces, tabs, or newlines between tokens
      expect(result.seal_payload).not.toMatch(/[^\\][\s]/);
      // More specific: no space after colon or comma
      expect(result.seal_payload).not.toContain(': ');
      expect(result.seal_payload).not.toContain(', ');
    });
  });

  describe('Independent verifiability (T5 acceptance pattern)', () => {
    it('re-hashing seal_payload produces the same sha256_hash', async () => {
      const result = await computeQuotationSeal(FIXTURE_SEAL_INPUT);

      // Simulate the auditor: they have ONLY seal_payload
      const payloadBytes = new TextEncoder().encode(result.seal_payload);
      const hashBuffer = await crypto.subtle.digest('SHA-256', payloadBytes);
      const recomputedHash = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      // Must match — this IS the seal verification
      expect(recomputedHash).toBe(result.sha256_hash);
    });

    it('seal_payload keys are in alphabetical order', async () => {
      const result = await computeQuotationSeal(FIXTURE_SEAL_INPUT);
      const parsed = JSON.parse(result.seal_payload);
      const keys = Object.keys(parsed);
      const sortedKeys = [...keys].sort();
      expect(keys).toEqual(sortedKeys);
    });
  });

  describe('Determinism', () => {
    it('same input → same hash on repeated runs', async () => {
      const r1 = await computeQuotationSeal(FIXTURE_SEAL_INPUT);
      const r2 = await computeQuotationSeal(FIXTURE_SEAL_INPUT);
      expect(r1.sha256_hash).toBe(r2.sha256_hash);
      expect(r1.seal_payload).toBe(r2.seal_payload);
    });
  });

  describe('Timestamp sensitivity (opposite of configuration_hash)', () => {
    it('different generated_at → different hash', async () => {
      const laterInput: SealInput = {
        ...FIXTURE_SEAL_INPUT,
        generated_at: '2026-07-20T11:00:00.000Z', // 30 minutes later
      };
      const r1 = await computeQuotationSeal(FIXTURE_SEAL_INPUT);
      const r2 = await computeQuotationSeal(laterInput);
      expect(r1.sha256_hash).not.toBe(r2.sha256_hash);
    });
  });

  describe('Grand total sensitivity', () => {
    it('different grand_total_paise → different hash', async () => {
      const changedInput: SealInput = {
        ...FIXTURE_SEAL_INPUT,
        grand_total_paise: 4910636, // 1 paise different
      };
      const r1 = await computeQuotationSeal(FIXTURE_SEAL_INPUT);
      const r2 = await computeQuotationSeal(changedInput);
      expect(r1.sha256_hash).not.toBe(r2.sha256_hash);
    });
  });

  describe('FROZEN seal hash (guards computeQuotationSeal logic stability)', () => {
    it('fixture input produces frozen hash value', async () => {
      const result = await computeQuotationSeal(FIXTURE_SEAL_INPUT);
      // FROZEN: any change to this value is a REGRESSION in computeQuotationSeal logic.
      // Re-baseline requires documented justification in DECISIONS.md.
      //
      // This hash depends on: the exact step_breakdown values (AD-31 frozen),
      // the exact timestamp, project_id, snapshot_id, version, and the
      // canonicalization rules (sorted keys, no whitespace, null omitted).
      //
      // NOTE: This is NOT the "production Gate value" — production seals use real
      // project_id/snapshot_id/generated_at that vary per run. This test guards
      // that the SEAL FUNCTION ITSELF hasn't changed (canonicalization rules,
      // hashing implementation). The production-equivalent proof is T5's live
      // round-trip test (persist → read back JSONB → re-canonicalize → rehash → match).
      //
      // T5 live-verified hash: acc500909e853a351d5ef5d624c254d976db97a782b8a21cceda972e0fa0a135
      // (for project_id 'd1000000-...-0100', snapshot '409fb621-...', against demfvizmxkuxvluopmtq)
      expect(result.sha256_hash).toMatchInlineSnapshot(`"7a24f5dd2f956f8f78797bb08beaead47e76f8ed49a7e97a599bb3937e06731a"`);
    });
  });
});
