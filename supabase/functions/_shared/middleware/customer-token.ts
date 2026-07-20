/**
 * Customer Token Middleware — Sprint 6 T3
 *
 * Token-scoped access control for /customer/v1/* routes.
 * Replaces JWT-based auth for customer portal (Option A: magic link, no login).
 *
 * Design decisions:
 * - Per-request middleware (single entry point for all customer routes)
 * - Uniform 401 TOKEN_INVALID for all failure cases (expired/invalidated/malformed/nonexistent)
 *   No information leakage about which tokens exist vs were invalidated.
 * - Token auth is SEPARATE from business state checks (e.g., quotation expired)
 *   Middleware only validates: "is this a valid, active token?"
 *   Endpoint-level guards handle: "is the project in the right status for this action?"
 *
 * Token extraction: from `Authorization: Bearer <token>` header or `?token=<token>` query param.
 * Token verification: HMAC-SHA256(raw_token, CUSTOMER_TOKEN_HASH_KEY) → compare to stored hash
 * via verify_customer_token RPC.
 *
 * Timing side-channel (conscious MVP acceptance):
 * Both nonexistent and invalidated tokens hit the same DB path
 * (WHERE token_hash = X AND invalidated_at IS NULL → NOT FOUND).
 * Valid vs invalid is distinguishable by timing (~1 DB round-trip difference).
 * 32-byte token entropy makes brute-force infeasible regardless.
 */

import { getAdminClient } from '../supabase.ts';
import { error } from '../response.ts';

const CUSTOMER_TOKEN_HASH_KEY = Deno.env.get('CUSTOMER_TOKEN_HASH_KEY')!;

export interface CustomerTokenContext {
  customerId: string;
  projectId: string;
  tokenId: string;
  expiresAt: string;
}

export type CustomerTokenResult =
  | { ok: true; context: CustomerTokenContext }
  | { ok: false; response: Response };

/**
 * Validate a customer magic-link token from the request.
 * Returns either the authenticated context (customer_id, project_id) or a 401 response.
 *
 * Token can be provided via:
 * 1. Authorization: Bearer <raw_token>
 * 2. Query parameter: ?token=<raw_token>
 *
 * The raw token is HMAC'd with CUSTOMER_TOKEN_HASH_KEY, then verified against the DB.
 */
export async function requireCustomerToken(req: Request): Promise<CustomerTokenResult> {
  // Extract raw token from request
  const rawToken = extractToken(req);

  if (!rawToken) {
    return {
      ok: false,
      response: error('TOKEN_INVALID', 'Missing or malformed access token', 401),
    };
  }

  // Validate token format (must be reasonable length — 32+ bytes base64url = 43+ chars)
  if (rawToken.length < 32 || rawToken.length > 128) {
    return {
      ok: false,
      response: error('TOKEN_INVALID', 'Missing or malformed access token', 401),
    };
  }

  // Compute HMAC-SHA256 of the raw token
  const tokenHash = await computeTokenHmac(rawToken);

  // Verify against DB via RPC
  const admin = getAdminClient();
  const { data, error: rpcError } = await admin.rpc('verify_customer_token', {
    p_token_hash: tokenHash,
  });

  if (rpcError) {
    // All RPC errors map to the same 401 — no leakage
    // ⚠️ CO-MAINTENANCE: exception messages from migration 00018
    return {
      ok: false,
      response: error('TOKEN_INVALID', 'Missing or malformed access token', 401),
    };
  }

  const result = data as {
    token_id: string;
    customer_id: string;
    project_id: string;
    expires_at: string;
    valid: boolean;
  };

  if (!result || !result.valid) {
    return {
      ok: false,
      response: error('TOKEN_INVALID', 'Missing or malformed access token', 401),
    };
  }

  return {
    ok: true,
    context: {
      customerId: result.customer_id,
      projectId: result.project_id,
      tokenId: result.token_id,
      expiresAt: result.expires_at,
    },
  };
}

/**
 * Extract raw token from request (header or query param).
 * Returns null if not found or malformed.
 */
function extractToken(req: Request): string | null {
  // Try Authorization header first
  const authHeader = req.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  // Fall back to query parameter
  const url = new URL(req.url);
  const tokenParam = url.searchParams.get('token');
  if (tokenParam) return tokenParam;

  return null;
}

/**
 * Compute HMAC-SHA256 of the raw token using CUSTOMER_TOKEN_HASH_KEY.
 * This produces the hash that's stored in customer_access_tokens.token_hash.
 *
 * Uses Web Crypto API (available in Deno/Edge Functions).
 */
async function computeTokenHmac(rawToken: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(CUSTOMER_TOKEN_HASH_KEY);
  const tokenData = encoder.encode(rawToken);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, tokenData);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
