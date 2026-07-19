/**
 * Edge Function: api-auth-login
 * Handles: POST /api/v1/auth/login
 * 
 * Sprint 1 T3 — Staff Login Endpoint
 * 
 * Flow:
 * 1. Check rate limit (10 failures/IP/15min, Postgres-backed)
 * 2. signInWithPassword() — validates credentials via Supabase Auth
 * 3. On auth success: query public.users for status (NOT from JWT — no JWT exists yet)
 * 4. If status ≠ ACTIVE → reject with 403 (do NOT return the token)
 * 5. If status = ACTIVE → return { access_token, user } in envelope
 * 
 * Status check distinction (explicit, per review):
 * - T3 (here): reads status from public.users directly (DB query at login time)
 * - T5 (rbac.ts): reads user_status from JWT app_metadata (per-request, post-login)
 * - T3 is the gate; T5 is the belt. Both are required.
 * 
 * Rate limiting:
 * - Storage: login_attempts table (Postgres, self-cleaning)
 * - Key: IP address (not email — prevents email enumeration via timing)
 * - Threshold: 10 failures per IP in 15 minutes
 * - On success: counter resets (old rows for this IP are purged)
 * - Edge case: legitimate users behind a shared NAT could be rate-limited
 *   if 10 other users from the same IP fail. Acceptable for MVP.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { success, error } from '../_shared/response.ts';

const RATE_LIMIT_WINDOW_MINUTES = 15;
const RATE_LIMIT_MAX_ATTEMPTS = 10;

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return error('METHOD_NOT_ALLOWED', 'Only POST is accepted', 405);
  }

  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return error('VALIDATION_ERROR', 'email and password are required', 400);
    }

    // Extract IP from request headers (Edge Functions behind a proxy)
    const ip = getClientIp(req);
    const admin = getAdminClient();

    // ─── Step 1: Rate limit check ───────────────────────────────────────
    const rateLimitResult = await checkRateLimit(admin, ip);
    if (!rateLimitResult.ok) {
      return error(
        'RATE_LIMITED',
        `Too many failed login attempts. Try again in ${RATE_LIMIT_WINDOW_MINUTES} minutes.`,
        429
      );
    }

    // ─── Step 2: Authenticate via Supabase Auth ─────────────────────────
    const { data: authData, error: authError } = await admin.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.user) {
      // Record the failed attempt for rate limiting
      await recordFailedAttempt(admin, ip, email);

      return error('INVALID_CREDENTIALS', 'Invalid email or password', 401);
    }

    // ─── Step 3: Check user status from public.users (NOT from JWT) ─────
    // At this point, Auth validated the credentials, but we haven't returned
    // a token yet. If the user is INACTIVE/PENDING_SETUP, we reject here
    // and the token is never exposed to the client.
    const { data: userRow, error: userError } = await admin
      .from('users')
      .select('user_id, email, role, status, full_name, mobile, department')
      .eq('user_id', authData.user.id)
      .single();

    if (userError || !userRow) {
      // User exists in Auth but not in public.users — could be a customer
      // trying the staff login endpoint, or an orphaned Auth entry.
      // Check if they're a customer trying the wrong endpoint.
      return error(
        'INVALID_CREDENTIALS',
        'No staff account found for these credentials',
        401
      );
    }

    // Status gate — this is the enforcement point, not just advisory
    if (userRow.status === 'INACTIVE') {
      return error('ACCOUNT_INACTIVE', 'Your account has been deactivated. Contact your administrator.', 403);
    }
    if (userRow.status === 'PENDING_SETUP') {
      return error('PENDING_SETUP', 'Your account setup is not yet complete. Contact your administrator.', 403);
    }

    // ─── Step 4: Success — clear rate limit history for this IP ──────────
    await clearRateLimitHistory(admin, ip);

    // ─── Step 5: Return token + user profile ────────────────────────────
    // Update last_login_at (non-blocking, don't fail the login if this errors)
    admin
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('user_id', userRow.user_id)
      .then(({ error: updateError }) => {
        if (updateError) console.error('Non-fatal: last_login_at update failed:', updateError);
      });

    return success({
      access_token: authData.session.access_token,
      expires_in: authData.session.expires_in,
      refresh_token: authData.session.refresh_token,
      user: {
        user_id: userRow.user_id,
        email: userRow.email,
        role: userRow.role,
        full_name: userRow.full_name,
        mobile: userRow.mobile,
        department: userRow.department,
      },
    });
  } catch (e) {
    console.error('api-auth-login error:', e);
    return error('INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
});

// ============================================================
// Rate Limiting — Postgres-backed, self-cleaning
// ============================================================

interface RateLimitResult {
  ok: boolean;
  attempts: number;
}

async function checkRateLimit(
  admin: ReturnType<typeof getAdminClient>,
  ip: string
): Promise<RateLimitResult> {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();

  // Self-cleaning: purge expired rows for this IP in the same query context
  await admin
    .from('login_attempts')
    .delete()
    .lt('attempted_at', windowStart);

  // Count recent failures for this IP
  const { count, error: countError } = await admin
    .from('login_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('ip_address', ip)
    .gte('attempted_at', windowStart);

  if (countError) {
    // If rate limit check fails, allow the attempt (fail open for availability)
    console.error('Rate limit check failed (allowing attempt):', countError);
    return { ok: true, attempts: 0 };
  }

  const attempts = count || 0;
  return { ok: attempts < RATE_LIMIT_MAX_ATTEMPTS, attempts };
}

async function recordFailedAttempt(
  admin: ReturnType<typeof getAdminClient>,
  ip: string,
  email: string
): Promise<void> {
  const { error: insertError } = await admin
    .from('login_attempts')
    .insert({ ip_address: ip, email });

  if (insertError) {
    // Non-fatal: rate limiting is defense-in-depth, not a critical path
    console.error('Failed to record login attempt:', insertError);
  }
}

async function clearRateLimitHistory(
  admin: ReturnType<typeof getAdminClient>,
  ip: string
): Promise<void> {
  // On successful login, clear all failed attempts for this IP
  // This prevents a legitimate user from being locked out after a few typos
  const { error: deleteError } = await admin
    .from('login_attempts')
    .delete()
    .eq('ip_address', ip);

  if (deleteError) {
    console.error('Non-fatal: failed to clear rate limit history:', deleteError);
  }
}

// ============================================================
// Helpers
// ============================================================

function getClientIp(req: Request): string {
  // Supabase Edge Functions run behind a proxy; real IP is in headers
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    // x-forwarded-for can be comma-separated; first is the client
    return forwarded.split(',')[0].trim();
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp;

  // Fallback — should never happen in production behind a proxy
  return '0.0.0.0';
}
