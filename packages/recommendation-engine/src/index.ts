/**
 * Recommendation Engine — Sprint 4 R1
 *
 * Evaluates all PUBLISHED templates against a space's context (design DNA,
 * budget, moisture, wall shape) and produces a ranked recommendation list.
 *
 * Two phases:
 * 1. Hard Constraint Filter (HC-1 through HC-6) — eliminates incompatible templates
 * 2. Weighted Scoring — ranks remaining templates by fit
 *
 * Scoring weights (Part 8):
 *   S = 0.30·style + 0.20·finish + 0.20·material + 0.15·lighting + 0.15·budget
 *   match_score_percent = ROUND(S × 100, 2)
 */

// ============================================================
// Types
// ============================================================

export interface SpaceContext {
  space_type: string;
  wall_shape: string | null;
  moisture_level: string; // from site_assessment: DRY, AMBIENT, HIGH
  budget_tier: string; // STANDARD, PREMIUM, LUXURY
  material_preference: string | null; // from design_dna
  design_style: string | null;
  colour_palette: string | null;
  finish_preference: string | null;
  lighting_preference: string | null;
}

export interface TemplateCandidate {
  template_id: string;
  template_name: string;
  compatible_spaces: string[];
  compatible_materials: string[];
  wall_shape: string | null;
  price_range: string | null; // STANDARD, PREMIUM, LUXURY
  theme: string | null;
  installation_type: string | null;
  template_type: string | null;
  // Element-level data for HC-5
  has_inactive_sku: boolean;
  // Scoring hints (from template metadata)
  colour_variant: string | null;
  finish_variant: string | null;
}

export interface HCResult {
  eliminated: boolean;
  eliminated_by: string | null; // HC-1 through HC-6 code, or null if passes
  reason: string | null;
}

export interface ScoringResult {
  style_score: number;
  finish_score: number;
  material_score: number;
  lighting_score: number;
  budget_score: number;
  raw_score: number;
  match_score_percent: number;
}

export interface RecommendationResult {
  template_id: string;
  template_name: string;
  hc_result: HCResult;
  scoring: ScoringResult | null; // null if eliminated by HC
  match_score_percent: number; // 0 if eliminated
}

// ============================================================
// Hard Constraint Filters (HC-1 through HC-6)
// ============================================================

/**
 * HC-1: Moisture mismatch — template must be compatible with space's moisture level.
 * A template's compatible_materials must include a material suitable for HIGH moisture.
 * For simplicity: if moisture is HIGH, template must have PVC or BAMBOO_CHARCOAL in compatible_materials.
 */
function hc1_moistureMismatch(ctx: SpaceContext, t: TemplateCandidate): string | null {
  if (ctx.moisture_level === 'HIGH') {
    const moistureResistant = ['PVC', 'BAMBOO_CHARCOAL'];
    const hasMoistureResistant = t.compatible_materials.some(m => moistureResistant.includes(m));
    if (!hasMoistureResistant) {
      return 'Template materials not suitable for HIGH moisture environment';
    }
  }
  return null;
}

/**
 * HC-2: Space incompatibility — template's compatible_spaces must include this space_type.
 */
function hc2_spaceIncompatibility(ctx: SpaceContext, t: TemplateCandidate): string | null {
  if (!t.compatible_spaces || t.compatible_spaces.length === 0) {
    return 'Template has no compatible_spaces defined';
  }
  if (!t.compatible_spaces.includes(ctx.space_type)) {
    return `Template not compatible with space type '${ctx.space_type}'`;
  }
  return null;
}

/**
 * HC-3: Wall shape mismatch — if template specifies a wall_shape, it must match.
 * Templates with null wall_shape are universal (compatible with all shapes).
 */
function hc3_wallShapeMismatch(ctx: SpaceContext, t: TemplateCandidate): string | null {
  if (t.wall_shape && ctx.wall_shape && t.wall_shape !== ctx.wall_shape) {
    return `Template requires wall_shape '${t.wall_shape}', space has '${ctx.wall_shape}'`;
  }
  return null;
}

/**
 * HC-4: Over-budget — template's price_range must not exceed project's budget_tier.
 * Tier ordering: STANDARD < PREMIUM < LUXURY
 * A STANDARD budget cannot select a PREMIUM or LUXURY template.
 */
function hc4_overBudget(ctx: SpaceContext, t: TemplateCandidate): string | null {
  if (!t.price_range) return null; // No price restriction = always in budget
  const tierOrder: Record<string, number> = { STANDARD: 1, PREMIUM: 2, LUXURY: 3 };
  const budgetLevel = tierOrder[ctx.budget_tier] ?? 1;
  const templateLevel = tierOrder[t.price_range] ?? 1;
  if (templateLevel > budgetLevel) {
    return `Template price '${t.price_range}' exceeds budget '${ctx.budget_tier}'`;
  }
  return null;
}

/**
 * HC-5: Inactive SKU — any element references a non-ACTIVE product.
 */
function hc5_inactiveSku(_ctx: SpaceContext, t: TemplateCandidate): string | null {
  if (t.has_inactive_sku) {
    return 'Template has one or more inactive SKUs in its elements';
  }
  return null;
}

/**
 * HC-6: Material incompatibility — effective material_preference not in template's compatible_materials.
 * If no material_preference set, this check passes (no constraint).
 */
function hc6_materialIncompatibility(ctx: SpaceContext, t: TemplateCandidate): string | null {
  if (!ctx.material_preference) return null;
  if (!t.compatible_materials || t.compatible_materials.length === 0) return null;
  if (!t.compatible_materials.includes(ctx.material_preference)) {
    return `Material preference '${ctx.material_preference}' not in template's compatible materials`;
  }
  return null;
}

/**
 * Run all hard constraint filters. Returns on first failure (short-circuit).
 */
export function runHardConstraintFilter(ctx: SpaceContext, t: TemplateCandidate): HCResult {
  const checks: [string, (ctx: SpaceContext, t: TemplateCandidate) => string | null][] = [
    ['HC-1', hc1_moistureMismatch],
    ['HC-2', hc2_spaceIncompatibility],
    ['HC-3', hc3_wallShapeMismatch],
    ['HC-4', hc4_overBudget],
    ['HC-5', hc5_inactiveSku],
    ['HC-6', hc6_materialIncompatibility],
  ];

  for (const [code, check] of checks) {
    const reason = check(ctx, t);
    if (reason) {
      return { eliminated: true, eliminated_by: code, reason };
    }
  }

  return { eliminated: false, eliminated_by: null, reason: null };
}

// ============================================================
// Weighted Scoring (Part 8)
// ============================================================

// Weights from Part 8:
// S = 0.30·style + 0.20·finish + 0.20·material + 0.15·lighting + 0.15·budget
const WEIGHTS = {
  style: 0.30,
  finish: 0.20,
  material: 0.20,
  lighting: 0.15,
  budget: 0.15,
};

/**
 * Style score: how well the template's theme matches the customer's design_style.
 * Returns 0.0 to 1.0.
 */
function scoreStyle(ctx: SpaceContext, t: TemplateCandidate): number {
  if (!ctx.design_style || !t.theme) return 0.5; // Neutral score when no preference
  // Map design styles to compatible themes (simplified heuristic)
  const styleThemeMap: Record<string, string[]> = {
    MODERN: ['Modern', 'Contemporary', 'Minimal'],
    CONTEMPORARY: ['Contemporary', 'Modern', 'Urban'],
    MINIMAL: ['Minimal', 'Scandinavian', 'Modern'],
    LUXURY: ['Luxury', 'Classic', 'Heritage'],
    SCANDINAVIAN: ['Scandinavian', 'Scandinavian Minimal', 'Minimal', 'Nordic'],
    INDUSTRIAL: ['Industrial', 'Urban', 'Loft'],
    CLASSIC: ['Classic', 'Heritage', 'Luxury'],
  };
  const compatibleThemes = styleThemeMap[ctx.design_style] || [];
  // Check if template theme partially matches any compatible theme
  const themeLC = t.theme.toLowerCase();
  const matches = compatibleThemes.some(ct => themeLC.includes(ct.toLowerCase()));
  return matches ? 1.0 : 0.2;
}

/**
 * Finish score: how well the template's finish matches customer's preference.
 */
function scoreFinish(ctx: SpaceContext, t: TemplateCandidate): number {
  if (!ctx.finish_preference || !t.finish_variant) return 0.5;
  return t.finish_variant.toUpperCase() === ctx.finish_preference.toUpperCase() ? 1.0 : 0.3;
}

/**
 * Material score: whether the customer's preferred material is in the template's compatible list.
 */
function scoreMaterial(ctx: SpaceContext, t: TemplateCandidate): number {
  if (!ctx.material_preference) return 0.5;
  if (t.compatible_materials.includes(ctx.material_preference)) return 1.0;
  return 0.2;
}

/**
 * Lighting score: how well the template's type matches customer's lighting preference.
 */
function scoreLighting(ctx: SpaceContext, t: TemplateCandidate): number {
  if (!ctx.lighting_preference) return 0.5;
  // Map lighting preferences to template types
  const wantsLighting = ['WARM_WHITE', 'NEUTRAL_WHITE', 'COOL_WHITE', 'COVE_LIGHTING', 'LINEAR_LED'];
  const customerWantsLighting = wantsLighting.includes(ctx.lighting_preference);
  const templateHasLighting = t.template_type === 'WALL_PANEL_WITH_LIGHTING';

  if (customerWantsLighting && templateHasLighting) return 1.0;
  if (!customerWantsLighting && !templateHasLighting) return 1.0;
  if (customerWantsLighting && !templateHasLighting) return 0.2;
  return 0.4; // Template has lighting but customer doesn't want it (mild penalty)
}

/**
 * Budget score: how well the template's price range aligns with budget.
 * Exact match = 1.0, within budget but lower tier = 0.7
 */
function scoreBudget(ctx: SpaceContext, t: TemplateCandidate): number {
  if (!t.price_range) return 0.5;
  const tierOrder: Record<string, number> = { STANDARD: 1, PREMIUM: 2, LUXURY: 3 };
  const budgetLevel = tierOrder[ctx.budget_tier] ?? 1;
  const templateLevel = tierOrder[t.price_range] ?? 1;
  if (templateLevel === budgetLevel) return 1.0;
  if (templateLevel < budgetLevel) return 0.7; // Under budget is OK but not ideal
  return 0.0; // Over budget (should have been HC-4'd, but defense in depth)
}

/**
 * Compute weighted score for a template that passed HC filters.
 */
export function computeScore(ctx: SpaceContext, t: TemplateCandidate): ScoringResult {
  const style_score = scoreStyle(ctx, t);
  const finish_score = scoreFinish(ctx, t);
  const material_score = scoreMaterial(ctx, t);
  const lighting_score = scoreLighting(ctx, t);
  const budget_score = scoreBudget(ctx, t);

  const raw_score =
    WEIGHTS.style * style_score +
    WEIGHTS.finish * finish_score +
    WEIGHTS.material * material_score +
    WEIGHTS.lighting * lighting_score +
    WEIGHTS.budget * budget_score;

  const match_score_percent = Math.round(raw_score * 10000) / 100; // ROUND(S*100, 2)

  return {
    style_score,
    finish_score,
    material_score,
    lighting_score,
    budget_score,
    raw_score,
    match_score_percent,
  };
}

// ============================================================
// Main Entry Point
// ============================================================

/**
 * Run the full recommendation engine for a list of template candidates.
 * Returns all templates with their HC result + score (sorted by score desc).
 */
export function runRecommendationEngine(
  ctx: SpaceContext,
  candidates: TemplateCandidate[]
): RecommendationResult[] {
  const results: RecommendationResult[] = candidates.map(t => {
    const hc_result = runHardConstraintFilter(ctx, t);

    if (hc_result.eliminated) {
      return {
        template_id: t.template_id,
        template_name: t.template_name,
        hc_result,
        scoring: null,
        match_score_percent: 0,
      };
    }

    const scoring = computeScore(ctx, t);
    return {
      template_id: t.template_id,
      template_name: t.template_name,
      hc_result,
      scoring,
      match_score_percent: scoring.match_score_percent,
    };
  });

  // Sort by match_score_percent descending (eliminated templates at bottom)
  results.sort((a, b) => b.match_score_percent - a.match_score_percent);

  return results;
}
