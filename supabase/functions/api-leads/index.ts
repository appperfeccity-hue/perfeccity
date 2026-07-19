/**
 * Edge Function: api-leads
 * Handles: POST /api/v1/leads, GET /api/v1/leads, GET /api/v1/leads/:id
 * 
 * Sprint 1 T6 — Lead Creation (WF-1) + Lead Queue
 * 
 * POST: Admin or Consultant — creates a lead with status=NEW
 *   - Mobile encrypted + hashed for uniqueness (E.164 format required)
 *   - Duplicate detection: 409 DUPLICATE_LEAD if mobile_hash exists for non-LOST lead
 * 
 * GET (list): paginated, role-scoped per Part 7:
 *   - Admin: all leads
 *   - Manager: all leads (for assignment queue — filter ?status=NEW for unassigned)
 *   - Consultant: own assigned leads only
 * 
 * GET /:id: single lead detail (Admin, Manager, or owning Consultant)
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireAuth } from '../_shared/middleware/rbac.ts';
import { getAdminClient, getUserClient } from '../_shared/supabase.ts';
import { success, error, paginated } from '../_shared/response.ts';
import { encryptMobile, decryptMobile, hashMobile } from '../_shared/crypto.ts';

serve(async (req: Request) => {
  const method = req.method;
  const url = new URL(req.url);

  try {
    if (method === 'POST') {
      return await handleCreate(req);
    }

    if (method === 'GET') {
      const leadId = extractLeadId(url.pathname);
      if (leadId) {
        return await handleGetOne(req, leadId);
      }
      return await handleList(req, url);
    }

    return error('METHOD_NOT_ALLOWED', 'Method not allowed', 405);
  } catch (e) {
    console.error('api-leads error:', e);
    return error('INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
});

// ============================================================
// POST — Create Lead (WF-1)
// ============================================================

interface CreateLeadBody {
  customer_name: string;
  mobile: string;        // E.164 format: +91XXXXXXXXXX
  email_address?: string;
  project_address?: string;
  city?: string;
  project_type?: string; // RESIDENTIAL | COMMERCIAL
  lead_source?: string;  // WEB | WALK_IN | REFERRAL | EXHIBITION | DIRECT_CALL | SOCIAL_MEDIA
  communication_preference?: string;
}

async function handleCreate(req: Request): Promise<Response> {
  // RBAC: Admin or Consultant (Part 2)
  const rbac = await requireAuth(req, ['ADMIN', 'SALESPERSON']);
  if (!rbac.ok) return rbac.response;

  const body: CreateLeadBody = await req.json();

  // Validate required fields
  if (!body.customer_name) return error('VALIDATION_ERROR', 'customer_name is required', 422, 'customer_name');
  if (!body.mobile) return error('VALIDATION_ERROR', 'mobile is required', 422, 'mobile');

  // Validate E.164 format (Indian mobile: +91 followed by 10 digits)
  if (!/^\+\d{10,15}$/.test(body.mobile)) {
    return error('VALIDATION_ERROR', 'mobile must be in E.164 format (e.g., +919876543210)', 422, 'mobile');
  }

  // Validate enum values if provided
  if (body.project_type && !['RESIDENTIAL', 'COMMERCIAL'].includes(body.project_type)) {
    return error('VALIDATION_ERROR', 'project_type must be RESIDENTIAL or COMMERCIAL', 422, 'project_type');
  }

  const validSources = ['WEB', 'WALK_IN', 'REFERRAL', 'EXHIBITION', 'DIRECT_CALL', 'SOCIAL_MEDIA'];
  if (body.lead_source && !validSources.includes(body.lead_source)) {
    return error('VALIDATION_ERROR', `lead_source must be one of: ${validSources.join(', ')}`, 422, 'lead_source');
  }

  const admin = getAdminClient();

  // Compute mobile hash for uniqueness check (deterministic SHA-256, no key)
  const mobileHash = await hashMobile(body.mobile);

  // Duplicate detection: check mobile_hash exists for non-LOST leads
  const { data: existingLead } = await admin
    .from('leads')
    .select('lead_id, status')
    .eq('mobile_hash', mobileHash)
    .neq('status', 'LOST')
    .limit(1)
    .single();

  if (existingLead) {
    return error('DUPLICATE_LEAD', 'A lead with this mobile number already exists', 409, 'mobile');
  }

  // Encrypt mobile for storage (AES-256-GCM, key from MOBILE_ENCRYPTION_KEY env var — AD-17)
  const mobileEncrypted = await encryptMobile(body.mobile);

  // Insert the lead
  const { data: newLead, error: insertError } = await admin
    .from('leads')
    .insert({
      customer_name: body.customer_name,
      mobile_encrypted: Array.from(mobileEncrypted), // bytea as array
      mobile_hash: mobileHash,
      email_address: body.email_address || null,
      project_address: body.project_address || null,
      city: body.city || null,
      project_type: body.project_type || null,
      lead_source: body.lead_source || null,
      communication_preference: body.communication_preference || null,
      status: 'NEW',
      created_by: rbac.auth.userId,
    })
    .select('lead_id, customer_name, email_address, city, project_type, lead_source, status, created_at')
    .single();

  if (insertError) {
    // Handle unique constraint violation (belt-and-suspenders with the check above)
    if (insertError.message.includes('mobile_hash') || insertError.code === '23505') {
      return error('DUPLICATE_LEAD', 'A lead with this mobile number already exists', 409, 'mobile');
    }
    console.error('Lead creation failed:', insertError);
    return error('DB_ERROR', 'Failed to create lead', 500);
  }

  return success(newLead, 201);
}

// ============================================================
// GET — List Leads (paginated, role-scoped)
// ============================================================

async function handleList(req: Request, url: URL): Promise<Response> {
  // RBAC: Admin (all), Manager (all), Consultant (own)
  const rbac = await requireAuth(req, ['ADMIN', 'MANAGER', 'SALESPERSON']);
  if (!rbac.ok) return rbac.response;

  const page = parseInt(url.searchParams.get('page') || '1');
  const perPage = Math.min(parseInt(url.searchParams.get('per_page') || '20'), 100);
  const statusFilter = url.searchParams.get('status');

  const admin = getAdminClient();

  let query = admin
    .from('leads')
    .select(
      'lead_id, customer_name, email_address, city, project_type, lead_source, status, assigned_consultant_id, created_at, updated_at',
      { count: 'exact' }
    );

  // Role-based scoping
  if (rbac.auth.role === 'SALESPERSON') {
    // Consultant: own assigned leads only
    query = query.eq('assigned_consultant_id', rbac.auth.userId);
  }
  // Admin and Manager see all leads (Manager needs full queue visibility for assignment)

  // Status filter (Manager uses ?status=NEW for the assignment queue)
  if (statusFilter) {
    query = query.eq('status', statusFilter);
  }

  // Ordering: oldest first for queue views (Manager), newest first otherwise
  if (statusFilter === 'NEW') {
    query = query.order('created_at', { ascending: true }); // oldest-first for queue (Part 9.2)
  } else {
    query = query.order('created_at', { ascending: false });
  }

  // Pagination
  query = query.range((page - 1) * perPage, page * perPage - 1);

  const { data, count, error: queryError } = await query;

  if (queryError) {
    console.error('Lead list query failed:', queryError);
    return error('DB_ERROR', 'Failed to retrieve leads', 500);
  }

  return paginated(data || [], page, perPage, count || 0);
}

// ============================================================
// GET /:id — Single Lead Detail
// ============================================================

async function handleGetOne(req: Request, leadId: string): Promise<Response> {
  // RBAC: Admin, Manager, or owning Consultant
  const rbac = await requireAuth(req, ['ADMIN', 'MANAGER', 'SALESPERSON']);
  if (!rbac.ok) return rbac.response;

  const admin = getAdminClient();

  const { data: lead, error: queryError } = await admin
    .from('leads')
    .select('*')
    .eq('lead_id', leadId)
    .single();

  if (queryError || !lead) {
    return error('LEAD_NOT_FOUND', 'No lead found with the specified ID', 404);
  }

  // Ownership check for Consultant: must be assigned to them
  if (rbac.auth.role === 'SALESPERSON' && lead.assigned_consultant_id !== rbac.auth.userId) {
    return error('FORBIDDEN', 'You do not have access to this lead', 403);
  }

  // Decrypt mobile for display (AES-256-GCM, requires MOBILE_ENCRYPTION_KEY env var)
  let decryptedMobile: string | null = null;
  if (lead.mobile_encrypted) {
    try {
      decryptedMobile = await decryptMobile(new Uint8Array(lead.mobile_encrypted));
    } catch (e) {
      console.error('Mobile decryption failed (key mismatch or corrupted data):', e);
      decryptedMobile = '[decryption failed]';
    }
  }

  return success({
    ...lead,
    mobile: decryptedMobile,
    mobile_encrypted: undefined, // strip raw bytes from response
  });
}

// ============================================================
// Helpers
// ============================================================
// Encryption + hashing now in _shared/crypto.ts (AD-17)

function extractLeadId(pathname: string): string | null {
  // Match UUID in path after /leads/
  const match = pathname.match(/leads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[1] : null;
}
