/**
 * Shared Supabase client initialization for Edge Functions.
 * 
 * Two clients available:
 * 1. supabaseClient — uses the user's JWT from the Authorization header (respects RLS)
 * 2. supabaseAdmin — uses the service_role key (bypasses RLS, for system operations)
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/**
 * User-scoped client — passes the caller's JWT, subject to RLS.
 * Use for operations that should respect row-level security.
 */
export function getUserClient(authHeader: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: authHeader },
    },
  });
}

/**
 * Admin client — uses service_role key, bypasses RLS.
 * Use for:
 * - Creating Supabase Auth users (admin API)
 * - System operations (notifications, state transitions)
 * - Operations where the calling user's RLS would block a legitimate action
 *   that's already been RBAC-authorized at the middleware level
 * 
 * SECURITY: Never expose this client's responses directly to the caller
 * without filtering — it can read ALL rows regardless of RLS.
 */
export function getAdminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
