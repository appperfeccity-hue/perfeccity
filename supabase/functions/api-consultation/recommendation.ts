/**
 * Recommendation Engine Handler — Sprint 4 R1
 *
 * POST /api/v1/projects/:id/spaces/:space_id/recommendation — runs engine
 * GET  /api/v1/projects/:id/spaces/:space_id/recommendation — reads cached result
 *
 * Assembles context from: project budget, design_dna, site_assessment, space data.
 * Fetches all PUBLISHED templates as candidates.
 * Runs HC-1 to HC-6 filter + weighted scoring.
 * Persists top results to space_recommendations table.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { success, error } from '../_shared/response.ts';
import { AuthContext } from '../_shared/middleware/rbac.ts';
import { requireProjectOwnership } from './sequencing.ts';

// ============================================================
// Inline Recommendation Engine (mirrors packages/recommendation-engine)
// ============================================================

interface SpaceContext {
  space_type: string;
  wall_shape: string | null;
  moisture_level: string;
  budget_tier: string;
  material_preference: string | null;
  design_style: string | null;
  colour_palette: string | null;
  finish_preference: string | null;
  lighting_preference: string | null;
}

interface TemplateCandidate {
  template_id: string;
  template_name: string;
  compatible_spaces: string[];
  compatible_materials: string[];
  wall_shape: string | null;
  price_range: string | null;
  theme: string | null;
  installation_type: string | null;
  template_type: string | null;
  has_inactive_sku: boolean;
  colour_variant: string | null;
  finish_variant: string | null;
}

function runHC(ctx: SpaceContext, t: TemplateCandidate): { eliminated: boolean; eliminated_by: string | null; reason: string | null } {
  // HC-1: Moisture
  if (ctx.moisture_level === 'HIGH') {
    const mr = ['PVC', 'BAMBOO_CHARCOAL'];
    if (!t.compatible_materials.some(m => mr.includes(m))) {
      return { eliminated: true, eliminated_by: 'HC-1', reason: 'Not moisture-resistant' };
    }
  }
  // HC-2: Space
  if (!t.compatible_spaces || t.compatible_spaces.length === 0 || !t.compatible_spaces.includes(ctx.space_type)) {
    return { eliminated: true, eliminated_by: 'HC-2', reason: `Not compatible with ${ctx.space_type}` };
  }
  // HC-3: Wall shape
  if (t.wall_shape && ctx.wall_shape && t.wall_shape !== ctx.wall_shape) {
    return { eliminated: true, eliminated_by: 'HC-3', reason: `Wall shape mismatch: ${t.wall_shape} vs ${ctx.wall_shape}` };
  }
  // HC-4: Budget
  if (t.price_range) {
    const tier: Record<string, number> = { STANDARD: 1, PREMIUM: 2, LUXURY: 3 };
    if ((tier[t.price_range] ?? 1) > (tier[ctx.budget_tier] ?? 1)) {
      return { eliminated: true, eliminated_by: 'HC-4', reason: `${t.price_range} exceeds ${ctx.budget_tier}` };
    }
  }
  // HC-5: Inactive SKU
  if (t.has_inactive_sku) {
    return { eliminated: true, eliminated_by: 'HC-5', reason: 'Inactive SKU in template' };
  }
  // HC-6: Material
  if (ctx.material_preference && t.compatible_materials.length > 0 && !t.compatible_materials.includes(ctx.material_preference)) {
    return { eliminated: true, eliminated_by: 'HC-6', reason: `Material ${ctx.material_preference} not compatible` };
  }
  return { eliminated: false, eliminated_by: null, reason: null };
}

function computeScore(ctx: SpaceContext, t: TemplateCandidate): number {
  const styleMap: Record<string, string[]> = {
    MODERN: ['modern', 'contemporary'], CONTEMPORARY: ['contemporary', 'modern'],
    MINIMAL: ['minimal', 'scandinavian'], LUXURY: ['luxury', 'classic'],
    SCANDINAVIAN: ['scandinavian', 'nordic', 'minimal'], INDUSTRIAL: ['industrial', 'urban', 'loft'],
    CLASSIC: ['classic', 'heritage'],
  };
  const style = (!ctx.design_style || !t.theme) ? 0.5 :
    (styleMap[ctx.design_style] || []).some(k => t.theme!.toLowerCase().includes(k)) ? 1.0 : 0.2;
  const finish = (!ctx.finish_preference || !t.finish_variant) ? 0.5 :
    t.finish_variant.toUpperCase() === ctx.finish_preference.toUpperCase() ? 1.0 : 0.3;
  const material = !ctx.material_preference ? 0.5 :
    t.compatible_materials.includes(ctx.material_preference) ? 1.0 : 0.2;
  const wantsLight = ['WARM_WHITE', 'NEUTRAL_WHITE', 'COOL_WHITE', 'COVE_LIGHTING', 'LINEAR_LED'];
  const hasLight = t.template_type === 'WALL_PANEL_WITH_LIGHTING';
  const lighting = !ctx.lighting_preference ? 0.5 :
    (wantsLight.includes(ctx.lighting_preference) && hasLight) ? 1.0 :
    (!wantsLight.includes(ctx.lighting_preference) && !hasLight) ? 1.0 :
    (wantsLight.includes(ctx.lighting_preference) && !hasLight) ? 0.2 : 0.4;
  const tierOrd: Record<string, number> = { STANDARD: 1, PREMIUM: 2, LUXURY: 3 };
  const budget = !t.price_range ? 0.5 :
    (tierOrd[t.price_range] === tierOrd[ctx.budget_tier]) ? 1.0 :
    (tierOrd[t.price_range]! < tierOrd[ctx.budget_tier]!) ? 0.7 : 0.0;

  const S = 0.30 * style + 0.20 * finish + 0.20 * material + 0.15 * lighting + 0.15 * budget;
  return Math.round(S * 10000) / 100;
}

// ============================================================
// Handlers
// ============================================================

export async function handleGetRecommendation(
  admin: SupabaseClient,
  projectId: string,
  spaceId: string,
  auth: AuthContext
): Promise<Response> {
  const ownership = await requireProjectOwnership(admin, projectId, auth.userId);
  if ('error' in ownership) return ownership.error;

  // Read cached recommendations
  const { data: cached } = await admin
    .from('space_recommendations')
    .select('*')
    .eq('space_id', spaceId)
    .eq('project_id', projectId)
    .order('match_score_percent', { ascending: false });

  if (!cached || cached.length === 0) {
    return success({ space_id: spaceId, recommendations: [], message: 'No recommendations yet. POST to generate.' });
  }

  return success({ space_id: spaceId, recommendations: cached });
}

export async function handleRunRecommendation(
  admin: SupabaseClient,
  projectId: string,
  spaceId: string,
  auth: AuthContext
): Promise<Response> {
  const ownership = await requireProjectOwnership(admin, projectId, auth.userId);
  if ('error' in ownership) return ownership.error;

  // Get space data
  const { data: space } = await admin
    .from('application_spaces')
    .select('space_id, space_type, wall_shape')
    .eq('space_id', spaceId)
    .eq('project_id', projectId)
    .single();

  if (!space) return error('SPACE_NOT_FOUND', 'Space not found', 404);

  // Get budget
  const { data: budget } = await admin
    .from('budget_profiles')
    .select('budget_tier')
    .eq('project_id', projectId)
    .single();

  const budgetTier = budget?.budget_tier || 'STANDARD';

  // Get design DNA
  const { data: dna } = await admin
    .from('design_dna')
    .select('*')
    .eq('project_id', projectId)
    .single();

  // Get site assessment (moisture)
  const { data: site } = await admin
    .from('site_assessments')
    .select('moisture_level')
    .eq('project_id', projectId)
    .single();

  const ctx: SpaceContext = {
    space_type: space.space_type,
    wall_shape: space.wall_shape || null,
    moisture_level: site?.moisture_level || 'DRY',
    budget_tier: budgetTier,
    material_preference: dna?.material_preference || null,
    design_style: dna?.design_style || null,
    colour_palette: dna?.colour_palette || null,
    finish_preference: dna?.finish_preference || null,
    lighting_preference: dna?.lighting_preference || null,
  };

  // Fetch all PUBLISHED templates with their elements
  const { data: templates } = await admin
    .from('design_templates')
    .select('template_id, template_name, compatible_spaces, compatible_materials, wall_shape, price_range, theme, installation_type, template_type, design_elements(sku, product_role, colour_variant, finish_variant, product_library(status, is_active))')
    .eq('status', 'PUBLISHED');

  if (!templates || templates.length === 0) {
    return success({ space_id: spaceId, recommendations: [], message: 'No PUBLISHED templates available' });
  }

  // Map to candidates
  const candidates: TemplateCandidate[] = templates.map((t: any) => {
    const elements = t.design_elements || [];
    const hasInactiveSku = elements.some((el: any) => {
      const pl = el.product_library;
      return pl && (pl.status !== 'ACTIVE' || !pl.is_active);
    });
    const primaryElement = elements.find((el: any) => el.product_role === 'PRIMARY');
    return {
      template_id: t.template_id,
      template_name: t.template_name,
      compatible_spaces: t.compatible_spaces || [],
      compatible_materials: t.compatible_materials || [],
      wall_shape: t.wall_shape,
      price_range: t.price_range,
      theme: t.theme,
      installation_type: t.installation_type,
      template_type: t.template_type,
      has_inactive_sku: hasInactiveSku,
      colour_variant: primaryElement?.colour_variant || null,
      finish_variant: primaryElement?.finish_variant || null,
    };
  });

  // Run engine
  const results = candidates.map(t => {
    const hc = runHC(ctx, t);
    if (hc.eliminated) {
      return { template_id: t.template_id, template_name: t.template_name, match_score_percent: 0, eliminated_by: hc.eliminated_by, reason: hc.reason };
    }
    const score = computeScore(ctx, t);
    return { template_id: t.template_id, template_name: t.template_name, match_score_percent: score, eliminated_by: null, reason: null };
  }).sort((a, b) => b.match_score_percent - a.match_score_percent);

  // Persist recommendations (replace old ones)
  await admin.from('space_recommendations').delete().eq('space_id', spaceId).eq('project_id', projectId);

  const rows = results.map((r, i) => ({
    space_id: spaceId,
    project_id: projectId,
    template_id: r.template_id,
    rank: i + 1,
    match_score_percent: r.match_score_percent,
    eliminated_by: r.eliminated_by,
    elimination_reason: r.reason,
  }));

  if (rows.length > 0) {
    await admin.from('space_recommendations').insert(rows);
  }

  return success({
    space_id: spaceId,
    total_candidates: candidates.length,
    passed_hc: results.filter(r => !r.eliminated_by).length,
    eliminated: results.filter(r => r.eliminated_by).length,
    recommendations: results.slice(0, 10), // Top 10
  });
}
