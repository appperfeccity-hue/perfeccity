/**
 * Rate Limiting — shared between staff and customer login endpoints.
 * 
 * Storage: Postgres `login_attempts` table (AD-13).
 * Key: IP address only (AD-13 tradeoffs documented in DECISIONS.md).
 * Shared namespace: staff + customer attempts counted together (AD-16).
 * 
 * Known concurrency note (AD-13):
 * Delete-then-count is two round-trips, not atomic. Under extreme concurrency
 * from one IP, count could be stale by 1-2 rows (attacker gets 11-12 instead
 * of 10). Functionally irrelevant for anti-abuse at this threshold.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RATE_LIMIT_WINDOW_MINUTES = 15;
const RATE_LIMIT_MAX_ATTEMPTS = 10;

export interface RateLimitResult {
  ok: boolean;
  attempts: number;
}

/**
 * Check if the IP has exceeded the rate limit.
 * Also self-cleans expired rows (>15min old) for this IP.
 */
export async function checkRateLimit(
  admin: SupabaseClient,
  ip: string
): Promise<RateLimitResult> {
  const windowStart = new Date(
    Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000
  ).toISOString();

  // Self-cleaning: purge expired rows (runs before count — AD-13 ordering note)
  await admin.from('login_attempts').delete().lt('attempted_at', windowStart);

  // Count recent failures for this IP
  const { count, error: countError } = await admin
    .from('login_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('ip_address', ip)
    .gte('attempted_at', windowStart);

  if (countError) {
    // Fail open: rate limiting is defense-in-depth, not a critical gate
    console.error('Rate limit check failed (allowing attempt):', countError);
    return { ok: true, attempts: 0 };
  }

  const attempts = count || 0;
  return { ok: attempts < RATE_LIMIT_MAX_ATTEMPTS, attempts };
}

/**
 * Record a failed login attempt.
 */
export async function recordFailedAttempt(
  admin: SupabaseClient,
  ip: string,
  email: string
): Promise<void> {
  const { error: insertError } = await admin
    .from('login_attempts')
    .insert({ ip_address: ip, email });

  if (insertError) {
    console.error('Non-fatal: failed to record login attempt:', insertError);
  }
}

/**
 * Clear all failed attempts for an IP on successful login.
 * Prevents a user from staying locked out after fixing their typos.
 */
export async function clearRateLimitHistory(
  admin: SupabaseClient,
  ip: string
): Promise<void> {
  const { error: deleteError } = await admin
    .from('login_attempts')
    .delete()
    .eq('ip_address', ip);

  if (deleteError) {
    console.error('Non-fatal: failed to clear rate limit history:', deleteError);
  }
}

/**
 * Extract client IP from request headers (Edge Functions behind proxy).
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp;
  return '0.0.0.0';
}

export { RATE_LIMIT_WINDOW_MINUTES };
