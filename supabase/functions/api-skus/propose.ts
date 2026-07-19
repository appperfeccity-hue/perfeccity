/**
 * SKU Propose — Designer path (WF-10)
 * 
 * POST /api/v1/skus/propose
 * Role: DESIGNER only
 * 
 * Creates a SKU proposal with status=PROPOSED.
 * Designer NEVER sets pricing (unit_cost_paise, sell_price_paise rejected).
 * Admin sets pricing at approval time (T3).
 * 
 * Pre-write checklist: single INSERT, no atomicity concern, no RPC needed.
 */

import { requireAuth } from '../_shared/middleware/rbac.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { success, error } from '../_shared/response.ts';

const VALID_CATEGORIES = ['WALL_PANEL', 'FURNITURE', 'TRIM', 'LIGHTING', 'CONSUMABLE'];
const VALID_FURNITURE_CATEGORIES = ['TV_CONSOLE', 'SHELF', 'CABINET', 'MANDIR', 'STUDY_UNIT'];
const VALID_MATERIALS = ['PVC', 'WPC', 'BAMBOO_CHARCOAL', 'UV_MARBLE'];

export async function handlePropose(req: Request): Promise<Response> {
  // RBAC: Designer only (Part 2: "SKU Master — propose new")
  const rbac = await requireAuth(req, ['DESIGNER']);
  if (!rbac.ok) return rbac.response;

  const body = await req.json();
  const admin = getAdminClient();

  // REJECT if pricing fields are present (Designer never sets price — Part 2/4)
  if (body.unit_cost_paise !== undefined || body.sell_price_paise !== undefined) {
    return error(
      'PRICING_NOT_ALLOWED',
      'Designers cannot set pricing. unit_cost_paise and sell_price_paise are set by Admin at approval.',
      422,
      'unit_cost_paise'
    );
  }

  // Validate required fields (same field validation as Admin path — R2b)
  if (!body.sku) return error('VALIDATION_ERROR', 'sku is required', 422, 'sku');
  if (!body.category) return error('VALIDATION_ERROR', 'category is required', 422, 'category');
  if (!body.name) return error('VALIDATION_ERROR', 'name is required', 422, 'name');
  if (!body.unit) return error('VALIDATION_ERROR', 'unit is required', 422, 'unit');

  // Validate enums
  if (!VALID_CATEGORIES.includes(body.category)) {
    return error('VALIDATION_ERROR', `category must be one of: ${VALID_CATEGORIES.join(', ')}`, 422, 'category');
  }
  if (body.furniture_category && !VALID_FURNITURE_CATEGORIES.includes(body.furniture_category)) {
    return error('VALIDATION_ERROR', `furniture_category must be one of: ${VALID_FURNITURE_CATEGORIES.join(', ')}`, 422, 'furniture_category');
  }
  if (body.material_family && !VALID_MATERIALS.includes(body.material_family)) {
    return error('VALIDATION_ERROR', `material_family must be one of: ${VALID_MATERIALS.join(', ')}`, 422, 'material_family');
  }

  // Category-specific: WALL_PANEL requires dimensions
  if (body.category === 'WALL_PANEL') {
    if (!body.width_mm || !body.height_mm) {
      return error('VALIDATION_ERROR', 'WALL_PANEL requires width_mm and height_mm', 422, 'width_mm');
    }
  }

  // Auto-derive dimensions display string
  const parts: string[] = [];
  if (body.width_mm) parts.push(`${body.width_mm}`);
  if (body.height_mm) parts.push(`${body.height_mm}`);
  if (body.thickness_mm) parts.push(`${body.thickness_mm}`);
  const dimensions = parts.length > 0 ? parts.join('×') + 'mm' : null;

  // Insert with status=PROPOSED, proposed_by=current user
  const { data, error: insertError } = await admin
    .from('product_library')
    .insert({
      sku: body.sku,
      category: body.category,
      name: body.name,
      unit: body.unit,
      unit_cost_paise: null,     // never set by Designer
      sell_price_paise: null,    // never set by Designer
      material_family: body.material_family || null,
      furniture_category: body.furniture_category || null,
      width_mm: body.width_mm || null,
      height_mm: body.height_mm || null,
      thickness_mm: body.thickness_mm || null,
      dimensions,
      is_active: false,          // not selectable until ACTIVE
      status: 'PROPOSED',
      proposed_by: rbac.auth.userId,
      created_by: rbac.auth.userId,
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      return error('DUPLICATE_SKU', `SKU '${body.sku}' already exists`, 409, 'sku');
    }
    console.error('SKU propose failed:', insertError);
    return error('DB_ERROR', 'Failed to create SKU proposal', 500);
  }

  return success(data, 201);
}
