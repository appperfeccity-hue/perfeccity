/**
 * Edge Function: api-users
 * Handles: POST /api/v1/users, GET /api/v1/users, PATCH /api/v1/users/:id
 * Role: ADMIN only (Part 2 permission matrix)
 * 
 * Sprint 1 T2 — User Creation Flow
 * 
 * ATOMICITY DECISION (AD-12, documented in DECISIONS.md):
 * Creating a user requires two operations:
 * 1. Create in Supabase Auth (assigns UUID)
 * 2. Insert into public.users (same UUID, profile data)
 * 
 * If step 1 succeeds but step 2 fails, we have an orphaned Auth user with no
 * profile row. The custom_access_token_hook would fail to find them in public.users
 * and default to 'CUSTOMER' role — a silent privilege misconfiguration.
 * 
 * Resolution: COMPENSATING DELETE pattern.
 * If the public.users insert fails after Auth creation succeeds, immediately delete
 * the Auth user. This is safer than an "upsert on retry" pattern because:
 * - It fails loudly (the caller gets an error and knows to retry)
 * - It doesn't leave zombie Auth entries that accumulate over time
 * - The retry is the caller's responsibility, making the operation idempotent
 *   only when the caller provides the same Idempotency-Key
 * 
 * The alternative (upsert-on-retry) was rejected because it requires tracking
 * whether a partial creation happened, which is more state than we want to manage
 * for an operation that should fail <0.1% of the time in practice.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireAuth } from '../_shared/middleware/rbac.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { success, error, paginated } from '../_shared/response.ts';

serve(async (req: Request) => {
  const method = req.method;
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/').filter(Boolean);

  // All endpoints require ADMIN role
  const rbac = await requireAuth(req, ['ADMIN']);
  if (!rbac.ok) return rbac.response;

  try {
    if (method === 'POST' && !pathParts.includes('users')) {
      return await handleCreate(req, rbac.auth.userId);
    }

    if (method === 'GET') {
      // Check if it's GET /users/:id or GET /users
      const userIdParam = extractUserIdFromPath(url.pathname);
      if (userIdParam) {
        return await handleGetOne(userIdParam);
      }
      return await handleList(url);
    }

    if (method === 'PATCH') {
      const userIdParam = extractUserIdFromPath(url.pathname);
      if (!userIdParam) {
        return error('BAD_REQUEST', 'User ID required for PATCH', 400);
      }
      return await handleUpdate(req, userIdParam);
    }

    // POST to the base path (create)
    if (method === 'POST') {
      return await handleCreate(req, rbac.auth.userId);
    }

    return error('METHOD_NOT_ALLOWED', 'Method not allowed', 405);
  } catch (e) {
    console.error('api-users error:', e);
    return error('INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
});

// ============================================================
// POST — Create user (Auth + public.users atomically)
// ============================================================

interface CreateUserBody {
  email: string;
  password: string;
  role: string;
  full_name: string;
  mobile?: string;
  department?: string;
}

async function handleCreate(req: Request, createdBy: string): Promise<Response> {
  const body: CreateUserBody = await req.json();

  // Validate required fields
  if (!body.email) return error('VALIDATION_ERROR', 'email is required', 422, 'email');
  if (!body.password) return error('VALIDATION_ERROR', 'password is required', 422, 'password');
  if (!body.role) return error('VALIDATION_ERROR', 'role is required', 422, 'role');
  if (!body.full_name) return error('VALIDATION_ERROR', 'full_name is required', 422, 'full_name');

  const validRoles = ['ADMIN', 'MANAGER', 'SALESPERSON', 'DESIGNER'];
  if (!validRoles.includes(body.role)) {
    return error('VALIDATION_ERROR', `role must be one of: ${validRoles.join(', ')}`, 422, 'role');
  }

  const admin = getAdminClient();

  // Step 1: Create in Supabase Auth
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true, // Skip email confirmation for admin-created users
    app_metadata: {
      role: body.role,
      user_status: 'ACTIVE',
    },
  });

  if (authError) {
    // Auth creation failed — no cleanup needed
    if (authError.message.includes('already been registered')) {
      return error('DUPLICATE_EMAIL', 'A user with this email already exists', 409, 'email');
    }
    return error('AUTH_ERROR', authError.message, 400);
  }

  const authUserId = authData.user.id;

  // Step 2: Insert into public.users with the SAME UUID (AD-2)
  const { data: userData, error: dbError } = await admin
    .from('users')
    .insert({
      user_id: authUserId, // AD-2: Auth UID = users.user_id
      email: body.email,
      password_hash: '(managed-by-supabase-auth)', // Sentinel — actual hash is in auth.users
      role: body.role,
      status: 'ACTIVE',
      full_name: body.full_name,
      mobile: body.mobile || null,
      department: body.department || null,
      created_by: createdBy,
    })
    .select()
    .single();

  if (dbError) {
    // COMPENSATING DELETE: Auth user was created but DB insert failed.
    // Delete the orphaned Auth user to prevent a zombie entry.
    console.error('public.users insert failed after Auth creation:', dbError);
    console.error('Executing compensating delete for Auth user:', authUserId);

    const { error: deleteError } = await admin.auth.admin.deleteUser(authUserId);
    if (deleteError) {
      // Compensating delete also failed — write to audit_log (durable, queryable)
      // console.error alone is ephemeral in Edge Functions — nobody would discover this.
      console.error('CRITICAL: Compensating delete ALSO failed. Orphaned Auth user:', authUserId, deleteError);

      // Write durable record so Admin can find orphaned users via:
      // SELECT * FROM audit_log WHERE action = 'ORPHANED_AUTH_USER_CLEANUP_FAILED'
      await admin.from('audit_log').insert({
        actor_id: createdBy,
        entity_type: 'auth_user',
        action: 'ORPHANED_AUTH_USER_CLEANUP_FAILED',
        details: {
          orphaned_auth_user_id: authUserId,
          email: body.email,
          original_error: dbError.message,
          delete_error: deleteError.message,
          requires_manual_cleanup: true,
        },
      });
    }

    // Return the original error to the caller
    if (dbError.message.includes('duplicate key')) {
      return error('DUPLICATE_EMAIL', 'A user with this email already exists in the users table', 409, 'email');
    }
    return error('DB_ERROR', 'Failed to create user profile: ' + dbError.message, 500);
  }

  return success(
    {
      user_id: userData.user_id,
      email: userData.email,
      role: userData.role,
      status: userData.status,
      full_name: userData.full_name,
      mobile: userData.mobile,
      department: userData.department,
      created_at: userData.created_at,
    },
    201
  );
}

// ============================================================
// GET — List users (paginated)
// ============================================================

async function handleList(url: URL): Promise<Response> {
  const page = parseInt(url.searchParams.get('page') || '1');
  const perPage = Math.min(parseInt(url.searchParams.get('per_page') || '20'), 100);
  const roleFilter = url.searchParams.get('role');
  const statusFilter = url.searchParams.get('status') || 'ACTIVE';

  const admin = getAdminClient();

  let query = admin
    .from('users')
    .select('user_id, email, role, status, full_name, mobile, department, created_at, last_login_at', { count: 'exact' });

  if (roleFilter) query = query.eq('role', roleFilter);
  if (statusFilter) query = query.eq('status', statusFilter);

  query = query
    .order('created_at', { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  const { data, count, error: queryError } = await query;

  if (queryError) {
    return error('DB_ERROR', queryError.message, 500);
  }

  return paginated(data || [], page, perPage, count || 0);
}

// ============================================================
// GET /:id — Single user
// ============================================================

async function handleGetOne(userId: string): Promise<Response> {
  const admin = getAdminClient();

  const { data, error: queryError } = await admin
    .from('users')
    .select('user_id, email, role, status, full_name, mobile, department, created_at, updated_at, last_login_at')
    .eq('user_id', userId)
    .single();

  if (queryError || !data) {
    return error('USER_NOT_FOUND', 'User not found', 404);
  }

  return success(data);
}

// ============================================================
// PATCH /:id — Update user (role/status/department)
// ============================================================

interface UpdateUserBody {
  role?: string;
  status?: string;
  full_name?: string;
  mobile?: string;
  department?: string;
}

async function handleUpdate(req: Request, userId: string): Promise<Response> {
  const body: UpdateUserBody = await req.json();
  const admin = getAdminClient();

  // Validate role if being changed
  if (body.role) {
    const validRoles = ['ADMIN', 'MANAGER', 'SALESPERSON', 'DESIGNER'];
    if (!validRoles.includes(body.role)) {
      return error('VALIDATION_ERROR', `role must be one of: ${validRoles.join(', ')}`, 422, 'role');
    }
  }

  // Validate status if being changed
  if (body.status) {
    const validStatuses = ['PENDING_SETUP', 'ACTIVE', 'INACTIVE'];
    if (!validStatuses.includes(body.status)) {
      return error('VALIDATION_ERROR', `status must be one of: ${validStatuses.join(', ')}`, 422, 'status');
    }
  }

  // Build the update payload (only include provided fields)
  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.role) updatePayload.role = body.role;
  if (body.status) updatePayload.status = body.status;
  if (body.full_name) updatePayload.full_name = body.full_name;
  if (body.mobile !== undefined) updatePayload.mobile = body.mobile;
  if (body.department !== undefined) updatePayload.department = body.department;

  // Update public.users
  const { data, error: dbError } = await admin
    .from('users')
    .update(updatePayload)
    .eq('user_id', userId)
    .select()
    .single();

  if (dbError || !data) {
    return error('USER_NOT_FOUND', 'User not found or update failed', 404);
  }

  // If role or status changed, sync to Supabase Auth app_metadata
  // This ensures the NEXT token issued (within 15min per AD-1) has the new role
  if (body.role || body.status) {
    const metadataUpdate: Record<string, string> = {};
    if (body.role) metadataUpdate.role = body.role;
    if (body.status) metadataUpdate.user_status = body.status;

    const { error: authUpdateError } = await admin.auth.admin.updateUserById(userId, {
      app_metadata: metadataUpdate,
    });

    if (authUpdateError) {
      // Non-fatal: the DB was updated, Auth metadata will catch up on next hook call
      // Log it but don't fail the response
      console.error('Warning: Auth metadata sync failed (will self-heal on next token refresh):', authUpdateError);
    }
  }

  return success({
    user_id: data.user_id,
    email: data.email,
    role: data.role,
    status: data.status,
    full_name: data.full_name,
    mobile: data.mobile,
    department: data.department,
    updated_at: data.updated_at,
  });
}

// ============================================================
// Helpers
// ============================================================

function extractUserIdFromPath(pathname: string): string | null {
  // Expected paths: /api/v1/users/:id or /users/:id
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const match = pathname.match(uuidRegex);
  return match ? match[0] : null;
}
