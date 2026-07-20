-- Migration 00017: Provision Customer Access RPC (Sprint 6 T1)
--
-- Atomically creates customer_accounts + customer_project_links after
-- the Edge Function has successfully created the Supabase Auth user.
--
-- Called by the quotation generation endpoint (api-quotation) as part of
-- the REVIEWED → QUOTED transition. The project cannot become QUOTED without
-- customer access being provisioned.
--
-- Idempotent: if customer_accounts already exists for this lead_id,
-- only ensures the customer_project_links row exists (doesn't duplicate).
--
-- Per pre-write checklist: SECURITY DEFINER + SET search_path + GRANT.
-- Compensating-delete pattern (AD-12): if this RPC fails, the calling Edge
-- Function must delete the orphaned Auth user it just created.

CREATE OR REPLACE FUNCTION public.provision_customer_access(
  p_project_id    UUID,
  p_lead_id       UUID,
  p_auth_user_id  UUID,
  p_email         VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id UUID;
  v_existing_customer RECORD;
  v_link_exists BOOLEAN;
BEGIN
  -- -------------------------------------------------------
  -- Guard: project must exist
  -- -------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM projects WHERE project_id = p_project_id) THEN
    RAISE EXCEPTION 'PROJECT_NOT_FOUND: %', p_project_id;
    -- ⚠️ CO-MAINTENANCE: matched by supabase/functions/api-quotation/index.ts
  END IF;

  -- -------------------------------------------------------
  -- Guard: lead must exist
  -- -------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM leads WHERE lead_id = p_lead_id) THEN
    RAISE EXCEPTION 'LEAD_NOT_FOUND: %', p_lead_id;
    -- ⚠️ CO-MAINTENANCE: matched by supabase/functions/api-quotation/index.ts
  END IF;

  -- -------------------------------------------------------
  -- Idempotent: check if customer_accounts already exists for this lead
  -- -------------------------------------------------------
  SELECT customer_id, auth_user_id
    INTO v_existing_customer
    FROM customer_accounts
   WHERE lead_id = p_lead_id;

  IF FOUND THEN
    -- Customer already exists — just ensure auth_user_id is set and link exists
    v_customer_id := v_existing_customer.customer_id;

    -- Update auth_user_id if not yet set (compensating for a previous partial failure)
    IF v_existing_customer.auth_user_id IS NULL THEN
      UPDATE customer_accounts
         SET auth_user_id = p_auth_user_id,
             updated_at = now()
       WHERE customer_id = v_customer_id;
    END IF;
  ELSE
    -- Create new customer_accounts row
    INSERT INTO customer_accounts (lead_id, email, password_hash, auth_user_id, status)
    VALUES (
      p_lead_id,
      p_email,
      'supabase-auth-managed',  -- password managed by Supabase Auth, not this column
      p_auth_user_id,
      'ACTIVE'
    )
    RETURNING customer_id INTO v_customer_id;
  END IF;

  -- -------------------------------------------------------
  -- Ensure customer_project_links exists (idempotent)
  -- -------------------------------------------------------
  SELECT EXISTS (
    SELECT 1 FROM customer_project_links
    WHERE customer_id = v_customer_id AND project_id = p_project_id
  ) INTO v_link_exists;

  IF NOT v_link_exists THEN
    INSERT INTO customer_project_links (customer_id, project_id)
    VALUES (v_customer_id, p_project_id);
  END IF;

  -- -------------------------------------------------------
  -- Return result
  -- -------------------------------------------------------
  RETURN jsonb_build_object(
    'customer_id', v_customer_id,
    'auth_user_id', p_auth_user_id,
    'project_id', p_project_id,
    'link_created', NOT v_link_exists,
    'already_existed', FOUND
  );
END;
$$;

-- Grants (per pre-write checklist)
GRANT EXECUTE ON FUNCTION public.provision_customer_access(UUID, UUID, UUID, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.provision_customer_access(UUID, UUID, UUID, VARCHAR) TO service_role;
