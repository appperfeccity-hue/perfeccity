/**
 * Edge Function: api-skus
 * Handles: GET/POST/PATCH /api/v1/skus, POST /skus/:sku/deactivate,
 *          POST /skus/propose, POST /skus/:sku/approve, POST /skus/:sku/reject
 * 
 * Sprint 3 T1–T4: SKU Master CRUD + Propose/Approve/Reject
 * 
 * Pre-write checklist applied:
 * - No DELETE operations (deactivate = status change)
 * - No multi-step writes in T1 (approve in T3 uses RPC)
 * - Admin client used for deactivate guard (checks design_elements on
 *   PUBLISHED templates — Consultant/Designer RLS can't do this join)
 * - Response envelope: standard {data, errors} / paginated
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireAuth } from '../_shared/middleware/rbac.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { success, error, paginated } from '../_shared/response.ts';

// Valid enum values (from Part 6)
const VALID_CATEGORIES = ['WALL_PANEL', 'FURNITURE', 'TRIM', 'LIGHTING', 'CONSUMABLE'];
const VALID_FURNITURE_CATEGORIES = ['TV_CONSOLE', 'SHELF', 'CABINET', 'MANDIR', 'STUDY_UNIT'];
const VALID_MATERIALS = ['PVC', 'WPC', 'BAMBOO_CHARCOAL', 'UV_MARBLE'];
const VALID_STATUSES = ['PROPOSED', 'ACTIVE', 'INACTIVE', 'REJECTED'];

serve(async (req: Request) => {
  const method = req.method;
  const url = new URL(req.url);
  const pathname = url.pathname;

  try {
    // Route: POST /skus/propose (Designer — T2)
    if (method === 'POST' && pathname.endsWith('/propose')) {
      const { handlePropose } = await import('./propose.ts');
      return await handlePropose(req);
    }

    // Route: POST /skus/:sku/approve (Admin — T3)
    if (method === 'POST' && pathname.includes('/approve')) {
      const { handleApprove } = await import('./approve.ts');
      return await handleApprove(req);
    }

    // Route: POST /skus/:sku/reject (Admin — T4)
    if (method === 'POST' && pathname.includes('/reject')) {
      const { handleReject } = await import('./reject.ts');
      return await handleReject(req);
    }

    // Route: POST /skus/:sku/deactivate (Admin)
    if (method === 'POST' && pathname.includes('/deactivate')) {
      return await handleDeactivate(req, pathname);
    }

    // Route: GET /skus/export (Admin — CSV download)
    if (method === 'GET' && pathname.endsWith('/export')) {
      return await handleExport(req);
    }

    // Route: POST /skus/import (Admin — CSV upload)
    if (method === 'POST' && pathname.includes('/import')) {
      return await handleImport(req, url);
    }

    // Route: POST /skus (Admin direct create)
    if (method === 'POST') {
      return await handleCreate(req);
    }

    // Route: PATCH /skus/:sku (Admin edit)
    if (method === 'PATCH') {
      return await handleUpdate(req, pathname);
    }

    // Route: GET /skus or GET /skus/:sku
    if (method === 'GET') {
      const sku = extractSku(pathname);
      if (sku) return await handleGetOne(req, sku);
      return await handleList(req, url);
    }

    return error('METHOD_NOT_ALLOWED', 'Method not allowed', 405);
  } catch (e) {
    console.error('api-skus error:', e);
    return error('INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
});

// ============================================================
// POST — Create SKU (Admin direct, status=ACTIVE immediately)
// ============================================================

async function handleCreate(req: Request): Promise<Response> {
  const rbac = await requireAuth(req, ['ADMIN']);
  if (!rbac.ok) return rbac.response;

  const body = await req.json();
  const admin = getAdminClient();

  // Validate required fields
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

  // Category-specific validation (R2b: same validation regardless of caller)
  if (body.category === 'WALL_PANEL') {
    if (!body.width_mm || !body.height_mm) {
      return error('VALIDATION_ERROR', 'WALL_PANEL requires width_mm and height_mm', 422, 'width_mm');
    }
  }

  // Auto-derive dimensions display string from numeric fields
  const dimensions = deriveDimensions(body.width_mm, body.height_mm, body.thickness_mm);

  const { data, error: insertError } = await admin
    .from('product_library')
    .insert({
      sku: body.sku,
      category: body.category,
      name: body.name,
      unit: body.unit,
      unit_cost_paise: body.unit_cost_paise || null,
      sell_price_paise: body.sell_price_paise || null,
      material_family: body.material_family || null,
      furniture_category: body.furniture_category || null,
      width_mm: body.width_mm || null,
      height_mm: body.height_mm || null,
      thickness_mm: body.thickness_mm || null,
      dimensions,
      is_active: true,
      status: 'ACTIVE',
      created_by: rbac.auth.userId,
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      return error('DUPLICATE_SKU', `SKU '${body.sku}' already exists`, 409, 'sku');
    }
    console.error('SKU create failed:', insertError);
    return error('DB_ERROR', 'Failed to create SKU', 500);
  }

  return success(data, 201);
}

// ============================================================
// PATCH — Update SKU (Admin, all fields except sku)
// ============================================================

async function handleUpdate(req: Request, pathname: string): Promise<Response> {
  const rbac = await requireAuth(req, ['ADMIN']);
  if (!rbac.ok) return rbac.response;

  const sku = extractSku(pathname);
  if (!sku) return error('BAD_REQUEST', 'SKU code required in path', 400);

  const body = await req.json();
  const admin = getAdminClient();

  // SKU code is immutable (Part 4, WF-10: "product_library.sku is immutable for life")
  if (body.sku !== undefined) {
    return error('IMMUTABLE_FIELD', 'SKU code cannot be changed after creation', 422, 'sku');
  }

  // Validate enums if provided
  if (body.category && !VALID_CATEGORIES.includes(body.category)) {
    return error('VALIDATION_ERROR', `category must be one of: ${VALID_CATEGORIES.join(', ')}`, 422, 'category');
  }
  if (body.material_family && !VALID_MATERIALS.includes(body.material_family)) {
    return error('VALIDATION_ERROR', `material_family must be one of: ${VALID_MATERIALS.join(', ')}`, 422, 'material_family');
  }

  // Build update payload
  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const allowedFields = [
    'category', 'name', 'unit', 'unit_cost_paise', 'sell_price_paise',
    'material_family', 'furniture_category', 'width_mm', 'height_mm',
    'thickness_mm', 'status',
  ];

  for (const field of allowedFields) {
    if (body[field] !== undefined) updatePayload[field] = body[field];
  }

  // Re-derive dimensions if any dimension field changed
  if (body.width_mm !== undefined || body.height_mm !== undefined || body.thickness_mm !== undefined) {
    // Need current values for fields not being updated
    const { data: current } = await admin
      .from('product_library')
      .select('width_mm, height_mm, thickness_mm')
      .eq('sku', sku)
      .single();

    const w = body.width_mm ?? current?.width_mm;
    const h = body.height_mm ?? current?.height_mm;
    const t = body.thickness_mm ?? current?.thickness_mm;
    updatePayload.dimensions = deriveDimensions(w, h, t);
  }

  // Sync is_active with status
  if (body.status) {
    updatePayload.is_active = body.status === 'ACTIVE';
  }

  const { data, error: updateError } = await admin
    .from('product_library')
    .update(updatePayload)
    .eq('sku', sku)
    .select()
    .single();

  if (updateError || !data) {
    return error('SKU_NOT_FOUND', `No SKU found with code '${sku}'`, 404);
  }

  return success(data);
}

// ============================================================
// POST /skus/:sku/deactivate — Admin only
// ============================================================

async function handleDeactivate(req: Request, pathname: string): Promise<Response> {
  const rbac = await requireAuth(req, ['ADMIN']);
  if (!rbac.ok) return rbac.response;

  const sku = extractSku(pathname);
  if (!sku) return error('BAD_REQUEST', 'SKU code required in path', 400);

  const admin = getAdminClient();

  // Guard: 409 SKU_IN_USE if referenced by a PUBLISHED template's design_elements
  // NOTE (pre-write checklist: service-role query): admin client used here because
  // this join (design_elements → design_templates WHERE status='PUBLISHED') is a
  // cross-table check that no single role's RLS would allow. The scoping is explicit:
  // only PUBLISHED templates count (not DRAFT/ARCHIVED).
  const { data: usageCheck } = await admin
    .from('design_elements')
    .select('element_id, template_id')
    .eq('sku', sku)
    .limit(1);

  if (usageCheck && usageCheck.length > 0) {
    // Check if the template is PUBLISHED
    const { data: template } = await admin
      .from('design_templates')
      .select('template_id, status')
      .eq('template_id', usageCheck[0].template_id)
      .eq('status', 'PUBLISHED')
      .single();

    if (template) {
      return error(
        'SKU_IN_USE',
        `Cannot deactivate: SKU '${sku}' is used in published template '${template.template_id}'`,
        409
      );
    }
  }

  // Perform deactivation
  const { data, error: updateError } = await admin
    .from('product_library')
    .update({ status: 'INACTIVE', is_active: false, updated_at: new Date().toISOString() })
    .eq('sku', sku)
    .eq('status', 'ACTIVE') // Can only deactivate ACTIVE SKUs
    .select()
    .single();

  if (updateError || !data) {
    return error('SKU_NOT_FOUND', `No active SKU found with code '${sku}'`, 404);
  }

  return success(data);
}

// ============================================================
// GET — List SKUs (paginated, filterable)
// ============================================================

async function handleList(req: Request, url: URL): Promise<Response> {
  // All staff can read (Part 2)
  const rbac = await requireAuth(req, ['ADMIN', 'MANAGER', 'SALESPERSON', 'DESIGNER']);
  if (!rbac.ok) return rbac.response;

  const page = parseInt(url.searchParams.get('page') || '1');
  const perPage = Math.min(parseInt(url.searchParams.get('per_page') || '20'), 100);
  const categoryFilter = url.searchParams.get('category');
  const statusFilter = url.searchParams.get('status');

  const admin = getAdminClient();

  let query = admin
    .from('product_library')
    .select('*', { count: 'exact' });

  if (categoryFilter) query = query.eq('category', categoryFilter);
  if (statusFilter) query = query.eq('status', statusFilter);

  query = query
    .order('created_at', { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  const { data, count, error: queryError } = await query;

  if (queryError) {
    console.error('SKU list query failed:', queryError);
    return error('DB_ERROR', 'Failed to retrieve SKUs', 500);
  }

  return paginated(data || [], page, perPage, count || 0);
}

// ============================================================
// GET /:sku — Single SKU
// ============================================================

async function handleGetOne(req: Request, sku: string): Promise<Response> {
  const rbac = await requireAuth(req, ['ADMIN', 'MANAGER', 'SALESPERSON', 'DESIGNER']);
  if (!rbac.ok) return rbac.response;

  const admin = getAdminClient();

  const { data, error: queryError } = await admin
    .from('product_library')
    .select('*')
    .eq('sku', sku)
    .single();

  if (queryError || !data) {
    return error('SKU_NOT_FOUND', `No SKU found with code '${sku}'`, 404);
  }

  return success(data);
}

// ============================================================
// Helpers
// ============================================================

/**
 * Auto-derive the display-only dimensions string from numeric fields.
 * v7.0: dimensions is display-only, generated from width_mm/height_mm/thickness_mm.
 * The quotation engine NEVER parses this field.
 */
function deriveDimensions(
  width_mm?: number | null,
  height_mm?: number | null,
  thickness_mm?: number | null
): string | null {
  const parts: string[] = [];
  if (width_mm) parts.push(`${width_mm}`);
  if (height_mm) parts.push(`${height_mm}`);
  if (thickness_mm) parts.push(`${thickness_mm}`);
  return parts.length > 0 ? parts.join('×') + 'mm' : null;
}

function extractSku(pathname: string): string | null {
  // SKU codes are alphanumeric with dashes (e.g., WLP-WPC-CLS-OAK-001)
  const match = pathname.match(/skus\/([A-Z0-9\-]+)/i);
  return match ? match[1] : null;
}


// ============================================================
// GET /skus/export — CSV Download (Admin only)
// ============================================================

async function handleExport(req: Request): Promise<Response> {
  const rbac = await requireAuth(req, ['ADMIN']);
  if (!rbac.ok) return rbac.response;

  const admin = getAdminClient();
  const { data: skus, error: queryErr } = await admin
    .from('product_library')
    .select('sku, name, category, furniture_category, material_family, unit, width_mm, height_mm, thickness_mm, unit_cost_paise, sell_price_paise, status, is_active, proposed_by')
    .order('sku', { ascending: true });

  if (queryErr) return error('DB_ERROR', 'Failed to export SKUs', 500);

  // Build CSV
  const headers = ['sku', 'name', 'category', 'furniture_category', 'material_family', 'unit', 'width_mm', 'height_mm', 'thickness_mm', 'unit_cost_paise', 'sell_price_paise', 'status', 'is_active'];
  const rows = (skus || []).map(s => headers.map(h => {
    const val = (s as Record<string, unknown>)[h];
    if (val === null || val === undefined) return '';
    const str = String(val);
    return str.includes(',') ? `"${str}"` : str;
  }).join(','));

  const csv = [headers.join(','), ...rows].join('\n');

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="skus-export.csv"',
    },
  });
}

// ============================================================
// POST /skus/import?dry_run=true|false — CSV Upload (Admin only)
// ============================================================

async function handleImport(req: Request, url: URL): Promise<Response> {
  const rbac = await requireAuth(req, ['ADMIN']);
  if (!rbac.ok) return rbac.response;

  const dryRun = url.searchParams.get('dry_run') !== 'false'; // default: dry_run=true

  const body = await req.text();
  if (!body.trim()) return error('VALIDATION_ERROR', 'CSV body is empty', 422);

  const lines = body.trim().split('\n');
  if (lines.length < 2) return error('VALIDATION_ERROR', 'CSV must have header + at least one data row', 422);

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const requiredHeaders = ['sku', 'name', 'category', 'unit'];
  const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
  if (missingHeaders.length > 0) {
    return error('VALIDATION_ERROR', `Missing required CSV headers: ${missingHeaders.join(', ')}`, 422);
  }

  const results: { row: number; sku: string; action: string; error?: string }[] = [];
  const admin = getAdminClient();

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });

    if (!row.sku || !row.name || !row.category) {
      results.push({ row: i + 1, sku: row.sku || '?', action: 'SKIP', error: 'Missing required field (sku/name/category)' });
      continue;
    }

    if (!VALID_CATEGORIES.includes(row.category)) {
      results.push({ row: i + 1, sku: row.sku, action: 'SKIP', error: `Invalid category: ${row.category}` });
      continue;
    }

    // Check if SKU exists
    const { data: existing } = await admin
      .from('product_library')
      .select('sku')
      .eq('sku', row.sku)
      .single();

    const payload: Record<string, unknown> = {
      sku: row.sku,
      name: row.name,
      category: row.category,
      unit: row.unit || 'pc',
      status: 'ACTIVE',
      is_active: true,
    };
    if (row.furniture_category) payload.furniture_category = row.furniture_category;
    if (row.material_family) payload.material_family = row.material_family;
    if (row.width_mm) payload.width_mm = parseInt(row.width_mm);
    if (row.height_mm) payload.height_mm = parseInt(row.height_mm);
    if (row.thickness_mm) payload.thickness_mm = parseInt(row.thickness_mm);
    if (row.unit_cost_paise) payload.unit_cost_paise = parseInt(row.unit_cost_paise);
    if (row.sell_price_paise) payload.sell_price_paise = parseInt(row.sell_price_paise);

    if (existing) {
      if (!dryRun) {
        const { sku: _s, ...updatePayload } = payload;
        await admin.from('product_library').update(updatePayload).eq('sku', row.sku);
      }
      results.push({ row: i + 1, sku: row.sku, action: 'UPDATE' });
    } else {
      if (!dryRun) {
        await admin.from('product_library').insert(payload);
      }
      results.push({ row: i + 1, sku: row.sku, action: 'INSERT' });
    }
  }

  return success({
    dry_run: dryRun,
    total_rows: lines.length - 1,
    processed: results.length,
    inserts: results.filter(r => r.action === 'INSERT').length,
    updates: results.filter(r => r.action === 'UPDATE').length,
    skipped: results.filter(r => r.action === 'SKIP').length,
    details: results,
    message: dryRun ? 'Dry run complete — no changes applied. Set dry_run=false to apply.' : 'Import complete.',
  });
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  result.push(current.trim());
  return result;
}
