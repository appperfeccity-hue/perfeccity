/**
 * Idempotency-Key Middleware
 *
 * Prevents duplicate processing of the same request when clients retry.
 * Uses a dedicated `idempotency_keys` table to store request fingerprints.
 *
 * Usage in endpoint handlers:
 *   const idem = await checkIdempotency(req, admin);
 *   if (idem.duplicate) return idem.cachedResponse!;
 *   // ... do work ...
 *   await saveIdempotencyResult(admin, idem.key!, response);
 *
 * Spec'd endpoints (Part 7): user creation, lead creation, payment,
 * quotation generation, template submission.
 *
 * Key format: `Idempotency-Key` header (client-provided UUID).
 * TTL: 24 hours (stale keys cleaned on read).
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface IdempotencyCheck {
  duplicate: boolean;
  key: string | null;
  cachedResponse: Response | null;
}

/**
 * Check if this request has been processed before.
 * If no Idempotency-Key header: returns { duplicate: false, key: null }
 * If key exists and was processed <24h ago: returns cached response
 * If key is new: returns { duplicate: false, key } — caller must save result after
 */
export async function checkIdempotency(
  req: Request,
  admin: SupabaseClient,
  endpoint: string
): Promise<IdempotencyCheck> {
  const key = req.headers.get('Idempotency-Key');
  if (!key) return { duplicate: false, key: null, cachedResponse: null };

  // Check if this key was already processed
  const { data: existing } = await admin
    .from('idempotency_keys')
    .select('response_status, response_body, created_at')
    .eq('idempotency_key', key)
    .eq('endpoint', endpoint)
    .single();

  if (existing) {
    // Check TTL (24 hours)
    const age = Date.now() - new Date(existing.created_at).getTime();
    if (age < 24 * 60 * 60 * 1000) {
      // Return cached response
      return {
        duplicate: true,
        key,
        cachedResponse: new Response(existing.response_body, {
          status: existing.response_status,
          headers: {
            'Content-Type': 'application/json',
            'X-Idempotency-Replayed': 'true',
          },
        }),
      };
    }
    // Expired — delete and treat as new
    await admin.from('idempotency_keys').delete().eq('idempotency_key', key).eq('endpoint', endpoint);
  }

  return { duplicate: false, key, cachedResponse: null };
}

/**
 * Save the response for this idempotency key so future retries return it.
 */
export async function saveIdempotencyResult(
  admin: SupabaseClient,
  key: string,
  endpoint: string,
  response: Response
): Promise<void> {
  const body = await response.clone().text();
  await admin.from('idempotency_keys').insert({
    idempotency_key: key,
    endpoint,
    response_status: response.status,
    response_body: body,
  }).then(() => {}).catch((e: Error) => {
    console.error('Non-fatal: idempotency key save failed:', e);
  });
}
