-- PERFECCITY MVP — Migration 00007: Custom Access Token Hook
-- Source: Sprint 1 spec, T1; Architectural Decision AD-7
--
-- This function is called by Supabase Auth at token issuance time to inject
-- the user's role from public.users into app_metadata.role on the JWT.
--
-- CRITICAL REGISTRATION STEPS (function alone does nothing):
-- 1. supabase/config.toml: [auth.hook.custom_access_token] enabled = true
-- 2. Hosted environments: Dashboard → Auth → Hooks → Custom Access Token
-- Without registration, tokens silently lack the role claim and ALL RLS
-- policies that call auth.user_role() will deny access.
--
-- Security notes (AD-27):
-- - NO SECURITY DEFINER on hook functions (Supabase docs explicitly recommend against it)
-- - Function runs as supabase_auth_admin (the invoker role), not as postgres
-- - GRANT EXECUTE to supabase_auth_admin: required for the hook to be callable
-- - GRANT SELECT ON public.users to supabase_auth_admin: required for the user lookup
-- - REVOKE EXECUTE FROM authenticated, anon, public: hook not accessible via REST API
-- - SET search_path removed: not needed without SECURITY DEFINER
--
-- Behavior:
-- - If user_id is found in public.users → injects that row's role
-- - If NOT found (customer_accounts flow) → injects 'CUSTOMER'
-- - This means customer_accounts users don't need a public.users row

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  _user_role TEXT;
  _user_status TEXT;
  claims JSONB;
BEGIN
  -- Look up the user's current role and status from the staff users table
  SELECT role::TEXT, status::TEXT
  INTO _user_role, _user_status
  FROM public.users
  WHERE user_id = (event->>'user_id')::UUID;

  -- If not found in users table, this is a customer account
  IF _user_role IS NULL THEN
    _user_role := 'CUSTOMER';
    _user_status := 'ACTIVE'; -- customer status is on customer_accounts, not checked here
  END IF;

  -- Inject role and status into app_metadata in the token claims
  -- Status is included so the login endpoint can check INACTIVE/PENDING_SETUP
  -- without a separate DB query after token issuance
  claims := event->'claims';
  claims := jsonb_set(claims, '{app_metadata,role}', to_jsonb(_user_role));
  claims := jsonb_set(claims, '{app_metadata,user_status}', to_jsonb(_user_status));

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- REQUIRED: Grant execute to supabase_auth_admin — this is the role that
-- Supabase Auth's internal machinery uses to call hook functions.
-- Without this grant, the hook is registered but silently fails to execute.
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;

-- Also grant to service_role for testing/debugging from Edge Functions
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO service_role;

-- Grant usage on the public schema to supabase_auth_admin so the function
-- can read from public.users when invoked by Auth
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT SELECT ON TABLE public.users TO supabase_auth_admin;

-- AD-27: Revoke from authenticated/anon (hook not accessible via REST API)
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;

-- AD-27: RLS policy allowing supabase_auth_admin to read users table
CREATE POLICY allow_auth_admin_to_read_users ON public.users
  AS PERMISSIVE FOR SELECT TO supabase_auth_admin USING (true);
