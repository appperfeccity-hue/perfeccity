import { describe, it, expect } from 'vitest';
import {
  runHardConstraintFilter,
  computeScore,
  runRecommendationEngine,
  SpaceContext,
  TemplateCandidate,
} from '../src/index';

// ============================================================
// Test fixtures
// ============================================================

const baseContext: SpaceContext = {
  space_type: 'TV_UNIT_WALL',
  wall_shape: 'STRAIGHT',
  moisture_level: 'DRY',
  budget_tier: 'PREMIUM',
  material_preference: 'WPC',
  design_style: 'SCANDINAVIAN',
  colour_palette: 'OAK',
  finish_preference: 'WOOD_GRAIN',
  lighting_preference: 'COVE_LIGHTING',
};

const baseTemplate: TemplateCandidate = {
  template_id: 'b0000000-0000-0000-0000-000000000001',
  template_name: 'Nordic Shadow',
  compatible_spaces: ['TV_UNIT_WALL', 'BED_BACK_WALL', 'LIVING_ROOM_FEATURE_WALL'],
  compatible_materials: ['WPC', 'PVC'],
  wall_shape: null, // universal
  price_range: 'PREMIUM',
  theme: 'Scandinavian Minimal',
  installation_type: 'FRAME_BASED',
  template_type: 'WALL_PANEL_WITH_LIGHTING',
  has_inactive_sku: false,
  colour_variant: 'OAK',
  finish_variant: 'WOOD_GRAIN',
};

// ============================================================
// HC-1: Moisture mismatch
// ============================================================

describe('HC-1: Moisture mismatch', () => {
  it('passes for DRY moisture regardless of materials', () => {
    const result = runHardConstraintFilter(baseContext, baseTemplate);
    expect(result.eliminated).toBe(false);
  });

  it('passes for HIGH moisture when template has PVC', () => {
    const ctx = { ...baseContext, moisture_level: 'HIGH' };
    const result = runHardConstraintFilter(ctx, baseTemplate);
    expect(result.eliminated).toBe(false);
  });

  it('eliminates for HIGH moisture when template lacks moisture-resistant material', () => {
    const ctx = { ...baseContext, moisture_level: 'HIGH' };
    const t = { ...baseTemplate, compatible_materials: ['WPC'] };
    const result = runHardConstraintFilter(ctx, t);
    expect(result.eliminated).toBe(true);
    expect(result.eliminated_by).toBe('HC-1');
  });

  it('passes for AMBIENT moisture (not HIGH)', () => {
    const ctx = { ...baseContext, moisture_level: 'AMBIENT' };
    const t = { ...baseTemplate, compatible_materials: ['WPC'] };
    const result = runHardConstraintFilter(ctx, t);
    expect(result.eliminated).toBe(false);
  });
});

// ============================================================
// HC-2: Space incompatibility
// ============================================================

describe('HC-2: Space incompatibility', () => {
  it('passes when space_type is in compatible_spaces', () => {
    const result = runHardConstraintFilter(baseContext, baseTemplate);
    expect(result.eliminated).toBe(false);
  });

  it('eliminates when space_type not in compatible_spaces', () => {
    const ctx = { ...baseContext, space_type: 'BATHROOM_WALL' };
    const result = runHardConstraintFilter(ctx, baseTemplate);
    expect(result.eliminated).toBe(true);
    expect(result.eliminated_by).toBe('HC-2');
  });

  it('eliminates when compatible_spaces is empty', () => {
    const t = { ...baseTemplate, compatible_spaces: [] };
    const result = runHardConstraintFilter(baseContext, t);
    expect(result.eliminated).toBe(true);
    expect(result.eliminated_by).toBe('HC-2');
  });
});

// ============================================================
// HC-3: Wall shape mismatch
// ============================================================

describe('HC-3: Wall shape mismatch', () => {
  it('passes when template wall_shape is null (universal)', () => {
    const result = runHardConstraintFilter(baseContext, baseTemplate);
    expect(result.eliminated).toBe(false);
  });

  it('passes when template wall_shape matches context', () => {
    const t = { ...baseTemplate, wall_shape: 'STRAIGHT' };
    const result = runHardConstraintFilter(baseContext, t);
    expect(result.eliminated).toBe(false);
  });

  it('eliminates when wall shapes differ', () => {
    const t = { ...baseTemplate, wall_shape: 'L_SHAPE' };
    const result = runHardConstraintFilter(baseContext, t);
    expect(result.eliminated).toBe(true);
    expect(result.eliminated_by).toBe('HC-3');
  });
});

// ============================================================
// HC-4: Over-budget
// ============================================================

describe('HC-4: Over-budget', () => {
  it('passes when template price matches budget', () => {
    const result = runHardConstraintFilter(baseContext, baseTemplate);
    expect(result.eliminated).toBe(false);
  });

  it('passes when template is cheaper than budget', () => {
    const t = { ...baseTemplate, price_range: 'STANDARD' };
    const result = runHardConstraintFilter(baseContext, t);
    expect(result.eliminated).toBe(false);
  });

  it('eliminates when template exceeds budget', () => {
    const ctx = { ...baseContext, budget_tier: 'STANDARD' };
    const t = { ...baseTemplate, price_range: 'LUXURY' };
    const result = runHardConstraintFilter(ctx, t);
    expect(result.eliminated).toBe(true);
    expect(result.eliminated_by).toBe('HC-4');
  });

  it('passes when template has no price_range (unrestricted)', () => {
    const t = { ...baseTemplate, price_range: null };
    const ctx = { ...baseContext, budget_tier: 'STANDARD' };
    const result = runHardConstraintFilter(ctx, t);
    expect(result.eliminated).toBe(false);
  });
});

// ============================================================
// HC-5: Inactive SKU
// ============================================================

describe('HC-5: Inactive SKU', () => {
  it('passes when no inactive SKUs', () => {
    const result = runHardConstraintFilter(baseContext, baseTemplate);
    expect(result.eliminated).toBe(false);
  });

  it('eliminates when template has inactive SKU', () => {
    const t = { ...baseTemplate, has_inactive_sku: true };
    const result = runHardConstraintFilter(baseContext, t);
    expect(result.eliminated).toBe(true);
    expect(result.eliminated_by).toBe('HC-5');
  });
});

// ============================================================
// HC-6: Material incompatibility
// ============================================================

describe('HC-6: Material incompatibility', () => {
  it('passes when material_preference is in compatible_materials', () => {
    const result = runHardConstraintFilter(baseContext, baseTemplate);
    expect(result.eliminated).toBe(false);
  });

  it('passes when no material_preference set', () => {
    const ctx = { ...baseContext, material_preference: null };
    const result = runHardConstraintFilter(ctx, baseTemplate);
    expect(result.eliminated).toBe(false);
  });

  it('eliminates when material_preference not in compatible list', () => {
    const ctx = { ...baseContext, material_preference: 'UV_MARBLE' };
    const result = runHardConstraintFilter(ctx, baseTemplate);
    expect(result.eliminated).toBe(true);
    expect(result.eliminated_by).toBe('HC-6');
  });
});

// ============================================================
// Scoring
// ============================================================

describe('Weighted Scoring', () => {
  it('produces perfect score for ideal match', () => {
    // Context: SCANDINAVIAN + WOOD_GRAIN + WPC + COVE_LIGHTING + PREMIUM
    // Template: Scandinavian Minimal + WOOD_GRAIN + WPC + WITH_LIGHTING + PREMIUM
    const scoring = computeScore(baseContext, baseTemplate);
    expect(scoring.style_score).toBe(1.0);
    expect(scoring.finish_score).toBe(1.0);
    expect(scoring.material_score).toBe(1.0);
    expect(scoring.lighting_score).toBe(1.0);
    expect(scoring.budget_score).toBe(1.0);
    expect(scoring.match_score_percent).toBe(100.0);
  });

  it('computes correct weighted formula', () => {
    // Force specific sub-scores to verify formula
    const ctx: SpaceContext = {
      ...baseContext,
      design_style: 'INDUSTRIAL', // won't match Scandinavian theme
      finish_preference: 'GLOSS', // won't match WOOD_GRAIN
      material_preference: 'BAMBOO_CHARCOAL', // not in WPC,PVC
      lighting_preference: 'NO_LIGHTING', // template has lighting
    };
    const scoring = computeScore(ctx, baseTemplate);
    // S = 0.30*style + 0.20*finish + 0.20*material + 0.15*lighting + 0.15*budget
    // style: 0.2 (no match), finish: 0.3 (no match), material: 0.2 (not in list), 
    // lighting: 0.4 (template has but customer doesn't want), budget: 1.0 (exact match)
    const expected = 0.30 * 0.2 + 0.20 * 0.3 + 0.20 * 0.2 + 0.15 * 0.4 + 0.15 * 1.0;
    expect(scoring.match_score_percent).toBe(Math.round(expected * 10000) / 100);
  });

  it('gives neutral score when no preferences set', () => {
    const ctx: SpaceContext = {
      ...baseContext,
      design_style: null,
      finish_preference: null,
      material_preference: null,
      lighting_preference: null,
    };
    const scoring = computeScore(ctx, baseTemplate);
    // All subscores should be 0.5 (neutral) except budget which has data
    expect(scoring.style_score).toBe(0.5);
    expect(scoring.finish_score).toBe(0.5);
    expect(scoring.material_score).toBe(0.5);
    expect(scoring.lighting_score).toBe(0.5);
    expect(scoring.budget_score).toBe(1.0); // PREMIUM = PREMIUM
  });
});

// ============================================================
// Full Pipeline
// ============================================================

describe('Full Recommendation Pipeline', () => {
  it('eliminates and scores correctly across multiple candidates', () => {
    const incompatible: TemplateCandidate = {
      ...baseTemplate,
      template_id: 'bad-template-1',
      template_name: 'Incompatible',
      compatible_spaces: ['BATHROOM_WALL'], // HC-2 fail
    };

    const overBudget: TemplateCandidate = {
      ...baseTemplate,
      template_id: 'bad-template-2',
      template_name: 'Too Expensive',
      price_range: 'LUXURY', // HC-4 fail for STANDARD budget
    };

    const ctx: SpaceContext = { ...baseContext, budget_tier: 'STANDARD' };
    const results = runRecommendationEngine(ctx, [baseTemplate, incompatible, overBudget]);

    expect(results.length).toBe(3);

    // baseTemplate passes HC but fails HC-4 (PREMIUM > STANDARD)
    const first = results.find(r => r.template_id === baseTemplate.template_id);
    expect(first?.hc_result.eliminated).toBe(true);
    expect(first?.hc_result.eliminated_by).toBe('HC-4');

    // incompatible fails HC-2
    const second = results.find(r => r.template_id === 'bad-template-1');
    expect(second?.hc_result.eliminated).toBe(true);
    expect(second?.hc_result.eliminated_by).toBe('HC-2');

    // overBudget fails HC-4
    const third = results.find(r => r.template_id === 'bad-template-2');
    expect(third?.hc_result.eliminated).toBe(true);
    expect(third?.hc_result.eliminated_by).toBe('HC-4');
  });

  it('sorts by match_score_percent descending', () => {
    const goodMatch: TemplateCandidate = { ...baseTemplate };
    const weakMatch: TemplateCandidate = {
      ...baseTemplate,
      template_id: 'weak-match',
      template_name: 'Weak Match',
      theme: 'Industrial Loft', // Won't match SCANDINAVIAN
      finish_variant: 'MATTE', // Won't match WOOD_GRAIN preference
    };

    const results = runRecommendationEngine(baseContext, [weakMatch, goodMatch]);
    expect(results[0].template_id).toBe(goodMatch.template_id);
    expect(results[0].match_score_percent).toBeGreaterThan(results[1].match_score_percent);
  });
});
