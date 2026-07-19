/**
 * RBAC Middleware — Sprint 1 T5 (partially implemented here for T2's needs)
 * 
 * Extracts JWT from Authorization header, validates it, and checks the caller's
 * role against the endpoint's allowed roles.
 * 
 * Enforcement points:
 * - Role check: app_metadata.role must be in allowedRoles
 * - Status check: app_metadata.user_status must be 'ACTIVE' (AD-9, T3/T5 enforcement)
 *   A token with role=ADMIN but user_status=INACTIVE is REJECTED here, not just at login.
 *   This is the enforcement point for the user_status claim injected by the hook (T1).
 * - Namespace guard: /api/v1/* rejects CUSTOMER; /customer/v1/* rejects non-CUSTOMER
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

export interface AuthContext {
  userId: string;
  role: string;
  userStatus: string;
  accessToken: string;
}

export type RbacResult =
  | { ok: true; auth: AuthContext }
  | { ok: false; response: Response };

/**
 * Validate the request's JWT and check role authorization.
 * Returns either the authenticated context or an error Response ready to return.
 * 
 * @param req - The incoming Request
 * @param allowedRoles - Array of role strings permitted to access this endpoint
 * @param namespace - 'staff' (default) or 'customer' — enforces endpoint namespace guard
 */
export async function requireAuth(
  req: Request,
  allowedRoles: string[],
  namespace: 'staff' | 'customer' = 'staff'
): Promise<RbacResult> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ data: null, errors: [{ code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' }] }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      ),
    };
  }

  const token = authHeader.replace('Bearer ', '');

  // Use Supabase client to validate the token and extract the user
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ data: null, errors: [{ code: 'INVALID_CREDENTIALS', message: 'Invalid or expired token' }] }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      ),
    };
  }

  const role = user.app_metadata?.role as string | undefined;
  const userStatus = user.app_metadata?.user_status as string | undefined;

  if (!role) {
    // This means the custom_access_token_hook isn't working (AD-7 failure)
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ data: null, errors: [{ code: 'ROLE_MISSING', message: 'Token lacks role claim — auth hook may not be registered (see AD-7)' }] }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      ),
    };
  }

  // Namespace guard: /api/v1/* rejects CUSTOMER; /customer/v1/* rejects non-CUSTOMER
  // This prevents a Customer from accessing staff endpoints even if they somehow
  // obtain a token with the right structure, and vice versa.
  if (namespace === 'staff' && role === 'CUSTOMER') {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ data: null, errors: [{ code: 'FORBIDDEN', message: 'Customer tokens cannot access staff endpoints' }] }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      ),
    };
  }
  if (namespace === 'customer' && role !== 'CUSTOMER') {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ data: null, errors: [{ code: 'FORBIDDEN', message: 'Staff tokens cannot access customer endpoints' }] }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      ),
    };
  }

  // Status enforcement — a suspended/pending user's token is valid (JWT hasn't expired)
  // but they must not be allowed to act. This is the 15-minute window from AD-1.
  if (userStatus && userStatus !== 'ACTIVE') {
    const code = userStatus === 'INACTIVE' ? 'ACCOUNT_INACTIVE' : 'PENDING_SETUP';
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ data: null, errors: [{ code, message: `Account status: ${userStatus}` }] }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      ),
    };
  }

  // Role check
  if (!allowedRoles.includes(role)) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ data: null, errors: [{ code: 'FORBIDDEN', message: `Role '${role}' is not permitted for this endpoint` }] }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      ),
    };
  }

  return {
    ok: true,
    auth: {
      userId: user.id,
      role,
      userStatus: userStatus || 'ACTIVE',
      accessToken: token,
    },
  };
}
