/**
 * Rule R8 Tests — Configuration Hash
 * 
 * ACTUALLY EXECUTED. Tests determinism + canonical serialization rules.
 * No spec-interpretation needed — rules are explicitly stated in Part 8.
 */

import { describe, it, expect } from 'vitest';
import { computeConfigurationHash, canonicalize, ConfigHashInput } from '../../src/rules/r8-configuration-hash';

describe('R8: canonicalize', () => {
  describe('Key sorting', () => {
    it('sorts object keys alphabetically', () => {
      const result = canonicalize({ z: 1, a: 2, m: 3 });
      expect(result).toBe('{"a":2,"m":3,"z":1}');
    });

    it('sorts recursively (nested objects)', () => {
      const result = canonicalize({ b: { z: 1, a: 2 }, a: 1 });
      expect(result).toBe('{"a":1,"b":{"a":2,"z":1}}');
    });
  });

  describe('Null omission', () => {
    it('omits null fields entirely', () => {
      const result = canonicalize({ a: 1, b: null, c: 3 });
      expect(result).toBe('{"a":1,"c":3}');
    });

    it('omits undefined fields', () => {
      const result = canonicalize({ a: 1, b: undefined, c: 3 });
      expect(result).toBe('{"a":1,"c":3}');
    });
  });

  describe('Number serialization', () => {
    it('integers as numbers (not strings)', () => {
      const result = canonicalize({ cost_paise: 32000 });
      expect(result).toBe('{"cost_paise":32000}');
    });

    it('decimals as numbers', () => {
      const result = canonicalize({ quantity: 9.72 });
      expect(result).toBe('{"quantity":9.72}');
    });
  });

  describe('No whitespace', () => {
    it('no spaces between tokens', () => {
      const result = canonicalize({ a: [1, 2, 3], b: { c: 4 } });
      expect(result).not.toContain(' ');
      expect(result).toBe('{"a":[1,2,3],"b":{"c":4}}');
    });
  });

  describe('Arrays', () => {
    it('preserves array order', () => {
      const result = canonicalize([{ sku: 'B' }, { sku: 'A' }]);
      expect(result).toBe('[{"sku":"B"},{"sku":"A"}]');
    });

    it('sorts keys within array elements', () => {
      const result = canonicalize([{ z: 1, a: 2 }]);
      expect(result).toBe('[{"a":2,"z":1}]');
    });
  });
});

describe('R8: computeConfigurationHash', () => {
  const baseInput: ConfigHashInput = {
    template_id: 'b0000000-0000-0000-0000-000000000001',
    measurements: {
      width_mm: 3600,
      height_mm: 2700,
      segment_b_mm: null,
      segment_c_mm: null,
      opening_deduction_sqmm: 0,
      gross_area_sqmm: 9720000,
      net_area_sqmm: 9720000,
    },
    line_items: [
      { sku: 'WLP-WPC-CLS-OAK-001', quantity: 18, unit_label: 'pc', product_role: 'PRIMARY', group_name: 'WALL_PANEL' },
      { sku: 'TRM-OAK-SGP-001', quantity: 41.34, unit_label: 'rft', product_role: 'TRIM', group_name: 'TRIM' },
    ],
    furniture: [],
  };

  it('same inputs → same hash (deterministic)', async () => {
    const hash1 = await computeConfigurationHash(baseInput);
    const hash2 = await computeConfigurationHash(baseInput);
    expect(hash1).toBe(hash2);
  });

  it('hash is a 64-character hex string (SHA-256)', async () => {
    const hash = await computeConfigurationHash(baseInput);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different inputs → different hash', async () => {
    const modified = {
      ...baseInput,
      measurements: { ...baseInput.measurements, width_mm: 3000 },
    };
    const hash1 = await computeConfigurationHash(baseInput);
    const hash2 = await computeConfigurationHash(modified);
    expect(hash1).not.toBe(hash2);
  });

  it('null measurement fields omitted (not serialized as null)', async () => {
    // Both should produce the same hash since null fields are omitted
    const withNull = { ...baseInput };
    const withoutNull = {
      ...baseInput,
      measurements: {
        width_mm: 3600,
        height_mm: 2700,
        opening_deduction_sqmm: 0,
        gross_area_sqmm: 9720000,
        net_area_sqmm: 9720000,
        // segment_b_mm and segment_c_mm not included at all
      },
    };

    const hash1 = await computeConfigurationHash(withNull);
    const hash2 = await computeConfigurationHash(withoutNull as ConfigHashInput);
    expect(hash1).toBe(hash2);
  });

  it('field ordering does not affect hash (keys are sorted)', async () => {
    // Reorder line_items fields — hash should be same since keys are sorted
    const reordered: ConfigHashInput = {
      ...baseInput,
      line_items: [
        { group_name: 'WALL_PANEL', product_role: 'PRIMARY', unit_label: 'pc', quantity: 18, sku: 'WLP-WPC-CLS-OAK-001' },
        { group_name: 'TRIM', product_role: 'TRIM', unit_label: 'rft', quantity: 41.34, sku: 'TRM-OAK-SGP-001' },
      ],
    };

    const hash1 = await computeConfigurationHash(baseInput);
    const hash2 = await computeConfigurationHash(reordered);
    expect(hash1).toBe(hash2);
  });

  it('furniture affects hash when present', async () => {
    const withFurniture: ConfigHashInput = {
      ...baseInput,
      furniture: [
        { sku: 'FRN-TVC-LINE-001', quantity: 1, default_position: 'CENTER', colour_variant: 'Oak' },
      ],
    };

    const hash1 = await computeConfigurationHash(baseInput);
    const hash2 = await computeConfigurationHash(withFurniture);
    expect(hash1).not.toBe(hash2);
  });

  it('configuration_hash is NOT unique globally (Part 5 note)', async () => {
    // Two different projects with identical inputs should produce the same hash
    // This is correct behavior, not a collision to prevent
    const input1 = { ...baseInput };
    const input2 = { ...baseInput }; // same inputs, conceptually different project

    const hash1 = await computeConfigurationHash(input1);
    const hash2 = await computeConfigurationHash(input2);
    expect(hash1).toBe(hash2); // intentionally equal
  });

  describe('[AD-25] Array ordering idempotency', () => {
    it('line_items in different insertion order → same hash', async () => {
      // AD-25: arrays are sorted before serialization.
      // Two configurations with same line items in different order MUST hash identically.
      const orderA: ConfigHashInput = {
        ...baseInput,
        line_items: [
          { sku: 'WLP-WPC-CLS-OAK-001', quantity: 18, unit_label: 'pc', product_role: 'PRIMARY', group_name: 'WALL_PANEL' },
          { sku: 'TRM-OAK-SGP-001', quantity: 41.34, unit_label: 'rft', product_role: 'TRIM', group_name: 'TRIM' },
          { sku: 'CSM-PVC-BSB-001', quantity: 9.72, unit_label: 'sqm', product_role: 'CONSUMABLE', group_name: 'CONSUMABLE' },
        ],
      };

      const orderB: ConfigHashInput = {
        ...baseInput,
        line_items: [
          { sku: 'CSM-PVC-BSB-001', quantity: 9.72, unit_label: 'sqm', product_role: 'CONSUMABLE', group_name: 'CONSUMABLE' },
          { sku: 'WLP-WPC-CLS-OAK-001', quantity: 18, unit_label: 'pc', product_role: 'PRIMARY', group_name: 'WALL_PANEL' },
          { sku: 'TRM-OAK-SGP-001', quantity: 41.34, unit_label: 'rft', product_role: 'TRIM', group_name: 'TRIM' },
        ],
      };

      const hashA = await computeConfigurationHash(orderA);
      const hashB = await computeConfigurationHash(orderB);
      expect(hashA).toBe(hashB);
    });

    it('furniture in different insertion order → same hash', async () => {
      const orderA: ConfigHashInput = {
        ...baseInput,
        furniture: [
          { sku: 'FRN-TVC-LINE-001', quantity: 1, default_position: 'CENTER', colour_variant: 'Oak' },
          { sku: 'FRN-SHF-CUBE-001', quantity: 2, default_position: 'LEFT', colour_variant: 'Oak' },
        ],
      };

      const orderB: ConfigHashInput = {
        ...baseInput,
        furniture: [
          { sku: 'FRN-SHF-CUBE-001', quantity: 2, default_position: 'LEFT', colour_variant: 'Oak' },
          { sku: 'FRN-TVC-LINE-001', quantity: 1, default_position: 'CENTER', colour_variant: 'Oak' },
        ],
      };

      const hashA = await computeConfigurationHash(orderA);
      const hashB = await computeConfigurationHash(orderB);
      expect(hashA).toBe(hashB);
    });

    it('same logical config, both arrays reordered → same hash', async () => {
      // Combined: both line_items AND furniture reordered simultaneously
      const orderA: ConfigHashInput = {
        template_id: 'b0000000-0000-0000-0000-000000000001',
        measurements: { width_mm: 3600, height_mm: 2700, gross_area_sqmm: 9720000, net_area_sqmm: 9720000 },
        line_items: [
          { sku: 'A-001', quantity: 10, unit_label: 'pc', product_role: 'PRIMARY', group_name: 'WALL_PANEL' },
          { sku: 'B-001', quantity: 5, unit_label: 'rft', product_role: 'TRIM', group_name: 'TRIM' },
          { sku: 'C-001', quantity: 3, unit_label: 'sqm', product_role: 'CONSUMABLE', group_name: 'CONSUMABLE' },
        ],
        furniture: [
          { sku: 'F-001', quantity: 1, default_position: 'LEFT', colour_variant: 'Oak' },
          { sku: 'F-002', quantity: 1, default_position: 'RIGHT', colour_variant: 'Oak' },
        ],
      };

      const orderB: ConfigHashInput = {
        template_id: 'b0000000-0000-0000-0000-000000000001',
        measurements: { width_mm: 3600, height_mm: 2700, gross_area_sqmm: 9720000, net_area_sqmm: 9720000 },
        line_items: [
          { sku: 'C-001', quantity: 3, unit_label: 'sqm', product_role: 'CONSUMABLE', group_name: 'CONSUMABLE' },
          { sku: 'A-001', quantity: 10, unit_label: 'pc', product_role: 'PRIMARY', group_name: 'WALL_PANEL' },
          { sku: 'B-001', quantity: 5, unit_label: 'rft', product_role: 'TRIM', group_name: 'TRIM' },
        ],
        furniture: [
          { sku: 'F-002', quantity: 1, default_position: 'RIGHT', colour_variant: 'Oak' },
          { sku: 'F-001', quantity: 1, default_position: 'LEFT', colour_variant: 'Oak' },
        ],
      };

      const hashA = await computeConfigurationHash(orderA);
      const hashB = await computeConfigurationHash(orderB);
      expect(hashA).toBe(hashB);
    });
  });
});
