/**
 * Edge Function: api-design-library
 * Router for Design Template Library endpoints (Sprint 3 T5-T8).
 *
 * Handles:
 * - POST   /api/v1/design-library              (create DRAFT)
 * - PATCH  /api/v1/design-library/:id          (update DRAFT, own only)
 * - GET    /api/v1/design-library              (list, all staff)
 * - GET    /api/v1/design-library/:id          (detail, all staff)
 * - POST   /api/v1/design-library/:id/validate (10-point)
 * - POST   /api/v1/design-library/:id/submit-review (DRAFT→READY_FOR_REVIEW)
 * - POST   /api/v1/design-library/:id/publish  (READY_FOR_REVIEW→PUBLISHED)
 * - POST   /api/v1/design-library/:id/request-changes (READY_FOR_REVIEW→DRAFT)
 * - POST   /api/v1/design-library/:id/archive  (PUBLISHED→ARCHIVED)
 * - POST   /api/v1/design-library/:id/unpublish (PUBLISHED→DRAFT, emergency)
 * - POST   /api/v1/design-library/:id/elements (replace elements)
 * - POST   /api/v1/design-library/:id/consumables (replace consumables)
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireAuth } from '../_shared/middleware/rbac.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { success, error, paginated } from '../_shared/response.ts';
import { runValidation } from './validate.ts';
import { handleSubmitReview } from './submit.ts';
import { handlePublish, handleRequestChanges } from './publish.ts';
import { handleArchive } from './archive.ts';
import { handleUnpublish } from './unpublish.ts';

serve(async (req: Request) => {
  const url = new URL(req.url);
  const method = req.method;

  // RBAC: ADMIN, DESIGNER, SALESPERSON can access (different permissions per route)
  const rbac = await requireAuth(req, ['ADMIN', 'DESIGNER', 'SALESPERSON']);
  if (!rbac.ok) return rbac.response;

  try {
    const admin = getAdminClient();
    const templateId = extractTemplateId(url.pathname);

    // POST /api/v1/design-library (create)
    if (method === 'POST' && !templateId) {
      if (!['ADMIN', 'DESIGNER'].includes(rbac.auth.role)) {
        return error('FORBIDDEN', 'Only ADMIN or DESIGNER can create templates', 403);
      }
      const body = await req.json();
      return await handleCreate(admin, rbac.auth, body);
    }

    // GET /api/v1/design-library (list)
    if (method === 'GET' && !templateId) {
      return await handleList(admin, url);
    }

    // All remaining routes require templateId
    if (!templateId) {
      return error('BAD_REQUEST', 'Template ID required in path', 400);
    }

    // GET /api/v1/design-library/:id (detail)
    if (method === 'GET') {
      return await handleGetDetail(admin, templateId);
    }

    // PATCH /api/v1/design-library/:id (update DRAFT)
    if (method === 'PATCH') {
      if (!['ADMIN', 'DESIGNER'].includes(rbac.auth.role)) {
        return error('FORBIDDEN', 'Only ADMIN or DESIGNER can edit templates', 403);
      }
      const body = await req.json();
      return await handleUpdate(admin, templateId, rbac.auth, body);
    }

    // POST routes (actions)
    if (method === 'POST') {
      if (url.pathname.includes('/validate')) {
        return await handleValidate(admin, templateId);
      }
      if (url.pathname.includes('/submit-review')) {
        if (!['ADMIN', 'DESIGNER'].includes(rbac.auth.role)) {
          return error('FORBIDDEN', 'Only ADMIN or DESIGNER can submit for review', 403);
        }
        return await handleSubmitReview(admin, templateId, rbac.auth);
      }
      if (url.pathname.includes('/request-changes')) {
        if (rbac.auth.role !== 'ADMIN') {
          return error('FORBIDDEN', 'Only ADMIN can request changes', 403);
        }
        const body = await req.json();
        return await handleRequestChanges(admin, templateId, rbac.auth, body);
      }
      if (url.pathname.includes('/publish')) {
        if (rbac.auth.role !== 'ADMIN') {
          return error('FORBIDDEN', 'Only ADMIN can publish templates', 403);
        }
        return await handlePublish(admin, templateId, rbac.auth);
      }
      if (url.pathname.includes('/archive')) {
        if (rbac.auth.role !== 'ADMIN') {
          return error('FORBIDDEN', 'Only ADMIN can archive templates', 403);
        }
        return await handleArchive(admin, templateId, rbac.auth);
      }
      if (url.pathname.includes('/unpublish')) {
        if (rbac.auth.role !== 'ADMIN') {
          return error('FORBIDDEN', 'Only ADMIN can unpublish templates', 403);
        }
        const body = await req.json();
        return await handleUnpublish(admin, templateId, rbac.auth, body);
      }
      if (url.pathname.includes('/elements')) {
        if (!['ADMIN', 'DESIGNER'].includes(rbac.auth.role)) {
          return error('FORBIDDEN', 'Only ADMIN or DESIGNER can edit elements', 403);
        }
        const body = await req.json();
        return await handleReplaceElements(admin, templateId, rbac.auth, body);
      }
      if (url.pathname.includes('/consumables')) {
        if (!['ADMIN', 'DESIGNER'].includes(rbac.auth.role)) {
          return error('FORBIDDEN', 'Only ADMIN or DESIGNER can edit consumables', 403);
        }
        const body = await req.json();
        return await handleReplaceConsumables(admin, templateId, rbac.auth, body);
      }
    }

    return error('METHOD_NOT_ALLOWED', 'Method not allowed', 405);
  } catch (e) {
    console.error('api-design-library error:', e);
    return error('INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
});

// ============================================================
// Inline handlers (CRUD + elements/consumables)
// ============================================================

async function handleCreate(
  admin: any, auth: { userId: string; role: string }, body: any
): Promise<Response> {
  if (!body.template_name) {
    return error('VALIDATION_ERROR', 'template_name is required', 422, 'template_name');
  }

  const { data, error: insertErr } = await admin
    .from('design_templates')
    .insert({
      template_name: body.template_name,
      collection: body.collection || null,
      space_type: body.space_type || null,
      theme: body.theme || null,
      tags: body.tags || null,
      price_range: body.price_range || null,
      template_type: body.template_type || null,
      wall_shape: body.wall_shape || null,
      default_wall_width_mm: body.default_wall_width_mm || null,
      default_wall_height_mm: body.default_wall_height_mm || null,
      min_width_mm: body.min_width_mm || null,
      max_width_mm: body.max_width_mm || null,
      min_height_mm: body.min_height_mm || null,
      max_height_mm: body.max_height_mm || null,
      wall_type: body.wall_type || null,
      installation_type: body.installation_type || null,
      compatible_materials: body.compatible_materials || null,
      compatible_spaces: body.compatible_spaces || null,
      status: 'DRAFT',
      created_by: auth.userId,
    })
    .select()
    .single();

  if (insertErr) {
    return error('DB_ERROR', 'Failed to create template: ' + insertErr.message, 500);
  }

  return success(data, 201);
}

async function handleList(admin: any, url: URL): Promise<Response> {
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const perPage = Math.min(parseInt(url.searchParams.get('per_page') || '20', 10), 100);
  const status = url.searchParams.get('status');
  const collection = url.searchParams.get('collection');

  let query = admin.from('design_templates').select('*', { count: 'exact' });
  if (status) query = query.eq('status', status);
  if (collection) query = query.eq('collection', collection);

  const { data, count, error: queryErr } = await query
    .order('created_at', { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  if (queryErr) {
    return error('DB_ERROR', 'Failed to list templates', 500);
  }

  return paginated(data || [], page, perPage, count || 0);
}

async function handleGetDetail(admin: any, templateId: string): Promise<Response> {
  const { data, error: queryErr } = await admin
    .from('design_templates')
    .select('*, design_elements(*, product_library(sku, name, status, is_active, category)), template_consumables(*), digital_assets(*)')
    .eq('template_id', templateId)
    .single();

  if (queryErr || !data) {
    return error('TEMPLATE_NOT_FOUND', 'Template not found', 404);
  }

  return success(data);
}

async function handleUpdate(
  admin: any, templateId: string, auth: { userId: string; role: string }, body: any
): Promise<Response> {
  // Fetch template to check ownership + status
  const { data: template } = await admin
    .from('design_templates')
    .select('template_id, status, created_by')
    .eq('template_id', templateId)
    .single();

  if (!template) return error('TEMPLATE_NOT_FOUND', 'Template not found', 404);

  // Only DRAFT can be edited
  if (template.status !== 'DRAFT') {
    return error('TEMPLATE_NOT_EDITABLE', `Template in status '${template.status}' cannot be edited. Only DRAFT templates are editable.`, 422);
  }

  // Designers can only edit their own
  if (auth.role === 'DESIGNER' && template.created_by !== auth.userId) {
    return error('FORBIDDEN', 'Designers can only edit their own templates', 403);
  }

  // Build update payload (only allowed fields)
  const allowed = [
    'template_name', 'collection', 'space_type', 'theme', 'tags', 'price_range',
    'template_type', 'wall_shape', 'default_wall_width_mm', 'default_wall_height_mm',
    'min_width_mm', 'max_width_mm', 'min_height_mm', 'max_height_mm',
    'wall_type', 'installation_type', 'compatible_materials', 'compatible_spaces',
  ];
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (body[key] !== undefined) payload[key] = body[key];
  }

  const { data, error: updateErr } = await admin
    .from('design_templates')
    .update(payload)
    .eq('template_id', templateId)
    .select()
    .single();

  if (updateErr) {
    return error('DB_ERROR', 'Failed to update template: ' + updateErr.message, 500);
  }

  return success(data);
}

async function handleValidate(admin: any, templateId: string): Promise<Response> {
  const results = await runValidation(admin, templateId);
  const allPassed = results.every(r => r.passed);
  return success({
    template_id: templateId,
    all_passed: allPassed,
    passed_count: results.filter(r => r.passed).length,
    total_checks: results.length,
    checks: results,
  });
}

async function handleReplaceElements(
  admin: any, templateId: string, auth: { userId: string; role: string }, body: any
): Promise<Response> {
  // Check template is DRAFT and owned
  const { data: template } = await admin
    .from('design_templates')
    .select('template_id, status, created_by')
    .eq('template_id', templateId)
    .single();

  if (!template) return error('TEMPLATE_NOT_FOUND', 'Template not found', 404);
  if (template.status !== 'DRAFT') {
    return error('TEMPLATE_NOT_EDITABLE', 'Only DRAFT templates can have elements replaced', 422);
  }
  if (auth.role === 'DESIGNER' && template.created_by !== auth.userId) {
    return error('FORBIDDEN', 'Designers can only edit their own templates', 403);
  }

  if (!body.elements || !Array.isArray(body.elements)) {
    return error('VALIDATION_ERROR', 'elements array is required', 422, 'elements');
  }

  // Furniture slot matrix guards (T8)
  const furnitureElements = [];
  for (const el of body.elements) {
    if (!el.sku || !el.product_role) {
      return error('VALIDATION_ERROR', 'Each element needs sku and product_role', 422, 'elements');
    }
    // Check if this is a furniture SKU
    const { data: product } = await admin
      .from('product_library')
      .select('sku, category, furniture_category')
      .eq('sku', el.sku)
      .single();
    if (product && product.category === 'FURNITURE') {
      furnitureElements.push({ ...el, furniture_category: product.furniture_category });
    }
  }

  // Max 1 TV_CONSOLE
  const tvConsoles = furnitureElements.filter(e => e.furniture_category === 'TV_CONSOLE');
  if (tvConsoles.length > 1) {
    return error('SLOT_ALREADY_OCCUPIED', 'Max 1 TV Console allowed per template', 422, 'elements');
  }

  // No duplicate default_position (except CUSTOM)
  const positions = furnitureElements
    .map(e => e.default_position)
    .filter((p: string) => p && p !== 'CUSTOM');
  const dupes = positions.filter((p: string, i: number) => positions.indexOf(p) !== i);
  if (dupes.length > 0) {
    return error('SLOT_ALREADY_OCCUPIED', `Duplicate position: ${[...new Set(dupes)].join(', ')}`, 422, 'elements');
  }

  // Full replacement: delete existing + insert new
  await admin.from('design_elements').delete().eq('template_id', templateId);

  const rows = body.elements.map((el: any) => ({
    template_id: templateId,
    sku: el.sku,
    product_role: el.product_role,
    default_quantity: el.default_quantity ?? null,
    colour_variant: el.colour_variant ?? null,
    finish_variant: el.finish_variant ?? null,
    default_position: el.default_position ?? null,
  }));

  const { data: inserted, error: insertErr } = await admin
    .from('design_elements')
    .insert(rows)
    .select();

  if (insertErr) {
    return error('DB_ERROR', 'Failed to insert elements: ' + insertErr.message, 500);
  }

  return success({ template_id: templateId, elements: inserted, count: inserted?.length || 0 });
}

async function handleReplaceConsumables(
  admin: any, templateId: string, auth: { userId: string; role: string }, body: any
): Promise<Response> {
  // Check template is DRAFT and owned
  const { data: template } = await admin
    .from('design_templates')
    .select('template_id, status, created_by')
    .eq('template_id', templateId)
    .single();

  if (!template) return error('TEMPLATE_NOT_FOUND', 'Template not found', 404);
  if (template.status !== 'DRAFT') {
    return error('TEMPLATE_NOT_EDITABLE', 'Only DRAFT templates can have consumables replaced', 422);
  }
  if (auth.role === 'DESIGNER' && template.created_by !== auth.userId) {
    return error('FORBIDDEN', 'Designers can only edit their own templates', 403);
  }

  if (!body.consumables || !Array.isArray(body.consumables)) {
    return error('VALIDATION_ERROR', 'consumables array is required', 422, 'consumables');
  }

  // Full replacement
  await admin.from('template_consumables').delete().eq('template_id', templateId);

  const rows = body.consumables.map((c: any) => ({
    template_id: templateId,
    sku: c.sku,
    quantity_formula: c.quantity_formula ?? null,
    condition_field: c.condition_field ?? null,
    condition_value: c.condition_value ?? null,
  }));

  const { data: inserted, error: insertErr } = await admin
    .from('template_consumables')
    .insert(rows)
    .select();

  if (insertErr) {
    return error('DB_ERROR', 'Failed to insert consumables: ' + insertErr.message, 500);
  }

  return success({ template_id: templateId, consumables: inserted, count: inserted?.length || 0 });
}

// ============================================================
// Helpers
// ============================================================

function extractTemplateId(pathname: string): string | null {
  const match = pathname.match(
    /design-library\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  return match ? match[1] : null;
}
