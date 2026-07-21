/**
 * Furniture CRUD — Sprint 4 Phase 3
 *
 * POST   /api/v1/projects/:id/spaces/:space_id/furniture — add furniture item
 * DELETE /api/v1/projects/:id/spaces/:space_id/furniture/:furniture_id — remove
 * GET    /api/v1/projects/:id/spaces/:space_id/furniture — list for space
 *
 * Slot matrix guards:
 * - Max 5 furniture items per space
 * - Max 1 TV_CONSOLE per space
 * - No duplicate default_position (unless CUSTOM)
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { success, error } from '../_shared/response.ts';
import { AuthContext } from '../_shared/middleware/rbac.ts';
import { requireProjectOwnership } from './sequencing.ts';

interface FurnitureBody {
  sku: string;
  quantity?: number;
  default_position?: string;
  colour_variant?: string;
}

export async function handleListFurniture(
  admin: SupabaseClient,
  projectId: string,
  spaceId: string,
  auth: AuthContext
): Promise<Response> {
  const ownership = await requireProjectOwnership(admin, projectId, auth.userId);
  if ('error' in ownership) return ownership.error;

  const { data, error: queryErr } = await admin
    .from('configured_furniture')
    .select('*, product_library(sku, name, category, furniture_category, sell_price_paise)')
    .eq('space_id', spaceId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (queryErr) return error('DB_ERROR', 'Failed to list furniture', 500);

  return success({ space_id: spaceId, furniture: data || [], count: data?.length || 0 });
}

export async function handleAddFurniture(
  admin: SupabaseClient,
  projectId: string,
  spaceId: string,
  auth: AuthContext,
  body: FurnitureBody
): Promise<Response> {
  const ownership = await requireProjectOwnership(admin, projectId, auth.userId);
  if ('error' in ownership) return ownership.error;

  // Validate SKU
  if (!body.sku) return error('VALIDATION_ERROR', 'sku is required', 422, 'sku');

  // Get the product from library
  const { data: product } = await admin
    .from('product_library')
    .select('sku, name, category, furniture_category, is_active, status, unit_cost_paise, sell_price_paise')
    .eq('sku', body.sku)
    .single();

  if (!product) return error('SKU_NOT_FOUND', `SKU '${body.sku}' not found in product library`, 404);
  if (!product.is_active || product.status !== 'ACTIVE') {
    return error('SKU_INACTIVE', `SKU '${body.sku}' is not active`, 422);
  }
  if (product.category !== 'FURNITURE') {
    return error('NOT_FURNITURE', `SKU '${body.sku}' is category '${product.category}', not FURNITURE`, 422);
  }

  // Get current config_id for this space (latest is_current)
  const { data: config } = await admin
    .from('space_configurations')
    .select('config_id')
    .eq('space_id', spaceId)
    .eq('is_current', true)
    .single();

  // Allow adding furniture even without config (pre-engine stage)
  const configId = config?.config_id || null;

  // Slot matrix guard: count existing furniture for this space
  const { count: existingCount } = await admin
    .from('configured_furniture')
    .select('*', { count: 'exact', head: true })
    .eq('space_id', spaceId)
    .eq('project_id', projectId);

  if (existingCount && existingCount >= 5) {
    return error('FURNITURE_LIMIT_EXCEEDED', 'Max 5 furniture items per space', 422);
  }

  // Slot matrix guard: max 1 TV_CONSOLE
  if (product.furniture_category === 'TV_CONSOLE') {
    const { count: tvCount } = await admin
      .from('configured_furniture')
      .select('*', { count: 'exact', head: true })
      .eq('space_id', spaceId)
      .eq('project_id', projectId)
      .filter('sku', 'in', `(${await getTvConsoleSKUs(admin)})`);

    // Simpler: check by joining
    const { data: existingTV } = await admin
      .from('configured_furniture')
      .select('furniture_id, sku')
      .eq('space_id', spaceId)
      .eq('project_id', projectId);

    if (existingTV) {
      // Check each existing item's furniture_category
      for (const item of existingTV) {
        const { data: p } = await admin.from('product_library').select('furniture_category').eq('sku', item.sku).single();
        if (p && p.furniture_category === 'TV_CONSOLE') {
          return error('SLOT_ALREADY_OCCUPIED', 'Max 1 TV Console per space', 422);
        }
      }
    }
  }

  // Slot matrix guard: no duplicate default_position (unless CUSTOM)
  if (body.default_position && body.default_position !== 'CUSTOM') {
    const { data: positionConflict } = await admin
      .from('configured_furniture')
      .select('furniture_id')
      .eq('space_id', spaceId)
      .eq('project_id', projectId)
      .eq('default_position', body.default_position)
      .limit(1);

    if (positionConflict && positionConflict.length > 0) {
      return error('SLOT_ALREADY_OCCUPIED',
        `Position '${body.default_position}' is already occupied. Use 'CUSTOM' for flexible placement.`, 422);
    }
  }

  const quantity = body.quantity || 1;
  const calculatedCost = (product.sell_price_paise || 0) * quantity;

  const { data: inserted, error: insertErr } = await admin
    .from('configured_furniture')
    .insert({
      space_id: spaceId,
      project_id: projectId,
      config_id: configId || '00000000-0000-0000-0000-000000000000', // placeholder if no config yet
      sku: body.sku,
      quantity,
      default_position: body.default_position || null,
      colour_variant: body.colour_variant || null,
      unit_cost_paise: product.sell_price_paise || 0,
      calculated_cost_paise: calculatedCost,
      added_by: auth.userId,
    })
    .select()
    .single();

  if (insertErr) {
    return error('DB_ERROR', 'Failed to add furniture: ' + insertErr.message, 500);
  }

  return success({
    furniture: inserted,
    product_name: product.name,
    message: 'Furniture item added',
  }, 201);
}

export async function handleRemoveFurniture(
  admin: SupabaseClient,
  projectId: string,
  spaceId: string,
  furnitureId: string,
  auth: AuthContext
): Promise<Response> {
  const ownership = await requireProjectOwnership(admin, projectId, auth.userId);
  if ('error' in ownership) return ownership.error;

  const { data: existing } = await admin
    .from('configured_furniture')
    .select('furniture_id')
    .eq('furniture_id', furnitureId)
    .eq('space_id', spaceId)
    .eq('project_id', projectId)
    .single();

  if (!existing) {
    return error('FURNITURE_NOT_FOUND', 'Furniture item not found in this space', 404);
  }

  const { error: deleteErr } = await admin
    .from('configured_furniture')
    .delete()
    .eq('furniture_id', furnitureId);

  if (deleteErr) {
    return error('DB_ERROR', 'Failed to remove furniture', 500);
  }

  return success({ furniture_id: furnitureId, message: 'Furniture item removed' });
}

// Helper to get TV console SKUs (not used — replaced by inline check above)
async function getTvConsoleSKUs(_admin: SupabaseClient): Promise<string> {
  return '';
}
