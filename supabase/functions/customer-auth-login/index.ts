/**
 * Edge Function: customer-auth-login
 * Handles: POST /customer/v1/auth/login
 * 
 * Sprint 1 T4 — Customer Login Endpoint
 * 
 * Same flow as staff login (T3) with these differences:
 * - Validates that the authenticated user has role = 'CUSTOMER' (from app_metadata)
 * - Rejects staff credentials with 403 (staff must use /api/v1/auth/login)
 * - Returns only customer-safe fields (no role field in response — implicit)
 * - Response never exposes: unit_cost_paise, margin, or any Part 7 forbidden keys
 * 
 * Rate limiting decision (AD-16):
 * SHARED table with staff login — same login_attempts table, same IP-keyed counter.
 * Rationale: rate limit is anti-abuse, IP-scoped. An attacker doesn't get extra
 * attempts by alternating endpoints. Splitting would double the threshold to 20.
 * 
 * Status check:
 * Reads from customer_accounts.status (NOT public.users — customers aren't in that table).
 * INVITED status means account exists but customer hasn't set up credentials yet.
 * SUSPENDED means administratively blocked.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { success, error } from '../_shared/response.ts';
import { checkRateLimit, recordFailedAttempt, clearRateLimitHistory, getClientIp, RATE_LIMIT_WINDOW_MINUTES } from '../_shared/rate-limit.ts';

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

    const ip = getClientIp(req);
    const admin = getAdminClient();

    // ─── Step 1: Rate limit check (shared table with staff — AD-16) ─────
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
      await recordFailedAttempt(admin, ip, email);
      return error('INVALID_CREDENTIALS', 'Invalid email or password', 401);
    }

    // ─── Step 3: Verify this is a CUSTOMER, not staff ───────────────────
    // The hook sets role in app_metadata at token creation time.
    // T2 sets it via Admin API createUser. Either way, it's reliable here.
    const role = authData.user.app_metadata?.role;

    if (role !== 'CUSTOMER') {
      // Staff user trying the customer endpoint — reject without leaking info
      return error(
        'FORBIDDEN',
        'Invalid credentials for this portal',
        403
      );
    }

    // ─── Step 4: Check customer account status from customer_accounts ───
    // Customers are NOT in public.users (that's staff only).
    // auth_user_id links to customer_accounts (AD-3).
    const { data: customerRow, error: customerError } = await admin
      .from('customer_accounts')
      .select('customer_id, email, status, lead_id')
      .eq('auth_user_id', authData.user.id)
      .single();

    if (customerError || !customerRow) {
      // Auth entry exists but no customer_accounts row.
      // This shouldn't happen in normal flow (convert creates both atomically),
      // but handle gracefully.
      return error(
        'ACCOUNT_NOT_FOUND',
        'Customer account not found. Contact your Design Consultant.',
        403
      );
    }

    // Status gate
    if (customerRow.status === 'SUSPENDED') {
      return error(
        'ACCOUNT_SUSPENDED',
        'Your account has been suspended. Contact support.',
        403
      );
    }
    if (customerRow.status === 'INVITED') {
      return error(
        'ACCOUNT_PENDING',
        'Your account setup is not yet complete. Please check your email for setup instructions.',
        403
      );
    }

    // ─── Step 5: Success — clear rate limit, return token ───────────────
    await clearRateLimitHistory(admin, ip);

    // Update last_login_at (non-blocking)
    admin
      .from('customer_accounts')
      .update({ last_login_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('customer_id', customerRow.customer_id)
      .then(({ error: updateError }) => {
        if (updateError) console.error('Non-fatal: customer last_login_at update failed:', updateError);
      });

    // Customer response — no role field, no pricing fields, minimal profile
    return success({
      access_token: authData.session.access_token,
      expires_in: authData.session.expires_in,
      refresh_token: authData.session.refresh_token,
      customer: {
        customer_id: customerRow.customer_id,
        email: customerRow.email,
      },
    });
  } catch (e) {
    console.error('customer-auth-login error:', e);
    return error('INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
});

// ============================================================
// Helpers
// ============================================================
// Rate limiting + IP extraction now in _shared/rate-limit.ts (AD-16: shared table)
