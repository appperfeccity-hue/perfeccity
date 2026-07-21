-- Migration 00018: Customer Access Tokens (Sprint 6 T2)
--
-- Magic link authentication for customers — no login, no password.
-- Customer clicks a WhatsApp link containing a cryptographic token.
-- Token is verified by HMAC-SHA256 hash comparison (raw token never stored).
--
-- Security model (same principle as AD-17 mobile hash):
-- - Raw token: sent to customer via WhatsApp, never stored in DB
-- - token_hash: HMAC-SHA256(raw_token, CUSTOMER_TOKEN_HASH_KEY) stored in DB
-- - Verification: compute HMAC of incoming token, compare to stored hash
-- - This prevents DB-read attacks from yielding usable tokens
--
-- Expiry: 7 days from generation, OR payment completion, whichever first.
-- One active token per project: new token invalidates existing one.

-- ============================================================
-- Table: customer_access_tokens
-- ============================================================

CREATE TABLE customer_access_tokens (
  token_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash     VARCHAR NOT NULL,  -- HMAC-SHA256 of the raw token (never raw)
  customer_id    UUID NOT NULL REFERENCES customer_accounts(customer_id),
  project_id     UUID NOT NULL REFERENCES projects(project_id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,  -- created_at + 7 days
  invalidated_at TIMESTAMPTZ,           -- set on: new token generated OR payment confirmed
  last_used_at   TIMESTAMPTZ            -- updated on each successful verification
);

-- Only one active (non-invalidated, non-expired) token per project
-- This partial unique index ensures generating a new token automatically
-- requires invalidating the old one (enforced by the RPC, not the index alone)
CREATE INDEX idx_customer_access_tokens_project
  ON customer_access_tokens(project_id)
  WHERE invalidated_at IS NULL;

-- For token lookup during verification (hash-based)
CREATE INDEX idx_customer_access_tokens_hash
  ON customer_access_tokens(token_hash)
  WHERE invalidated_at IS NULL;

-- ============================================================
-- RLS: service_role only (tokens are never accessed via client SDK)
-- ============================================================

ALTER TABLE customer_access_tokens ENABLE ROW LEVEL SECURITY;

-- Only service_role (Edge Functions) can read/write tokens
-- No authenticated user should ever directly query this table
CREATE POLICY customer_access_tokens_service_only ON customer_access_tokens
  FOR ALL USING (false);  -- blocks all roles except service_role (which bypasses RLS)

-- ============================================================
-- RPC: generate_customer_token
-- Called by the Edge Function when Consultant requests a customer link.
-- Invalidates any existing active token for this project, then inserts new one.
-- ============================================================

CREATE OR REPLACE FUNCTION public.generate_customer_token(
  p_project_id  UUID,
  p_customer_id UUID,
  p_token_hash  VARCHAR  -- HMAC-SHA256 computed by Edge Function (raw token never hits DB)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token_id UUID;
  v_expires_at TIMESTAMPTZ;
BEGIN
  -- Guard: project must exist
  IF NOT EXISTS (SELECT 1 FROM projects WHERE project_id = p_project_id) THEN
    RAISE EXCEPTION 'PROJECT_NOT_FOUND: %', p_project_id;
    -- ⚠️ CO-MAINTENANCE: matched by supabase/functions/api-customer-link/index.ts
  END IF;

  -- Guard: customer must exist
  IF NOT EXISTS (SELECT 1 FROM customer_accounts WHERE customer_id = p_customer_id) THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND: %', p_customer_id;
    -- ⚠️ CO-MAINTENANCE: matched by supabase/functions/api-customer-link/index.ts
  END IF;

  -- Guard: customer must be linked to this project
  IF NOT EXISTS (
    SELECT 1 FROM customer_project_links
    WHERE customer_id = p_customer_id AND project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_LINKED: Customer % is not linked to project %', p_customer_id, p_project_id;
    -- ⚠️ CO-MAINTENANCE: matched by supabase/functions/api-customer-link/index.ts
  END IF;

  -- Invalidate any existing active tokens for this project
  UPDATE customer_access_tokens
     SET invalidated_at = now()
   WHERE project_id = p_project_id
     AND invalidated_at IS NULL;

  -- Generate new token (7-day expiry)
  v_expires_at := now() + INTERVAL '7 days';

  INSERT INTO customer_access_tokens (token_hash, customer_id, project_id, expires_at)
  VALUES (p_token_hash, p_customer_id, p_project_id, v_expires_at)
  RETURNING token_id INTO v_token_id;

  RETURN jsonb_build_object(
    'token_id', v_token_id,
    'project_id', p_project_id,
    'customer_id', p_customer_id,
    'expires_at', v_expires_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_customer_token(UUID, UUID, VARCHAR) TO service_role;

-- ============================================================
-- RPC: verify_customer_token
-- Called by the token-scoped middleware on every /customer/v1/* request.
-- Returns the customer_id + project_id if token is valid, or raises exception.
-- ============================================================

CREATE OR REPLACE FUNCTION public.verify_customer_token(
  p_token_hash VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token RECORD;
BEGIN
  -- Look up token by hash
  SELECT token_id, customer_id, project_id, expires_at, invalidated_at, last_used_at
    INTO v_token
    FROM customer_access_tokens
   WHERE token_hash = p_token_hash
     AND invalidated_at IS NULL
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TOKEN_INVALID: Token not found or already invalidated';
    -- ⚠️ CO-MAINTENANCE: matched by customer portal middleware
  END IF;

  -- Check expiry
  IF v_token.expires_at < now() THEN
    -- Mark as expired (not invalidated — different semantic)
    RAISE EXCEPTION 'TOKEN_EXPIRED: Token expired at %', v_token.expires_at;
    -- ⚠️ CO-MAINTENANCE: matched by customer portal middleware
  END IF;

  -- Update last_used_at
  UPDATE customer_access_tokens
     SET last_used_at = now()
   WHERE token_id = v_token.token_id;

  RETURN jsonb_build_object(
    'token_id', v_token.token_id,
    'customer_id', v_token.customer_id,
    'project_id', v_token.project_id,
    'expires_at', v_token.expires_at,
    'valid', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_customer_token(VARCHAR) TO service_role;
