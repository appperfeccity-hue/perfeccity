-- PERFECCITY MVP — Migration 00008: Lead Assignment RPC Function
-- Source: Sprint 1 T7; Part 4 (WF-2); Part 10 (Gate 4)
--
-- This function performs the ENTIRE lead assignment atomically:
-- 1. Guard: status must be 'NEW' (else 409 LEAD_ALREADY_ASSIGNED)
-- 2. UPDATE leads (status, assigned_consultant_id, assigned_by_manager_id, assigned_at)
-- 3. INSERT lead_activities row (audit trail)
-- 4. INSERT notifications row (LEAD_ASSIGNED)
--
-- All four steps in ONE transaction — guard without audit trail is incomplete (AD-6).
--
-- Security:
-- - SECURITY DEFINER: Manager's RLS can't directly write assigned_by_manager_id
-- - SET search_path = public: prevents schema-injection privilege escalation (AD-5)
-- - FOR UPDATE row lock: prevents concurrent assignment race

CREATE OR REPLACE FUNCTION assign_lead_to_consultant(
  p_lead_id UUID,
  p_consultant_id UUID,
  p_manager_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _lead RECORD;
  _consultant RECORD;
  _result JSONB;
BEGIN
  -- Validate the consultant exists and is an active SALESPERSON
  SELECT user_id, full_name, role, status
  INTO _consultant
  FROM users
  WHERE user_id = p_consultant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONSULTANT_NOT_FOUND'
      USING ERRCODE = 'P0003',
            HINT = 'The specified consultant_id does not exist in the users table';
  END IF;

  IF _consultant.role != 'SALESPERSON' THEN
    RAISE EXCEPTION 'NOT_A_CONSULTANT'
      USING ERRCODE = 'P0004',
            HINT = 'The specified user is not a Design Consultant (role must be SALESPERSON)';
  END IF;

  IF _consultant.status != 'ACTIVE' THEN
    RAISE EXCEPTION 'CONSULTANT_INACTIVE'
      USING ERRCODE = 'P0005',
            HINT = 'The specified consultant account is not active';
  END IF;

  -- Lock the lead row to prevent concurrent assignment
  SELECT * INTO _lead
  FROM leads
  WHERE lead_id = p_lead_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEAD_NOT_FOUND'
      USING ERRCODE = 'P0001',
            HINT = 'No lead exists with the specified lead_id';
  END IF;

  -- THE GUARD: status must be NEW (Part 4, WF-2; Part 10, Gate 4)
  IF _lead.status != 'NEW' THEN
    RAISE EXCEPTION 'LEAD_ALREADY_ASSIGNED'
      USING ERRCODE = 'P0002',
            HINT = 'Lead status is ' || _lead.status || ', not NEW. Only NEW leads can be assigned.';
  END IF;

  -- Step 1: Update the lead — full transition, not just the guard
  UPDATE leads SET
    assigned_consultant_id = p_consultant_id,
    assigned_by_manager_id = p_manager_id,
    assigned_at = now(),
    status = 'ASSIGNED',
    updated_at = now()
  WHERE lead_id = p_lead_id;

  -- Step 2: Audit trail — lead_activities row
  INSERT INTO lead_activities (lead_id, actor_id, activity_type, note)
  VALUES (
    p_lead_id,
    p_manager_id,
    'ASSIGNMENT',
    'Lead assigned to ' || _consultant.full_name || ' by manager'
  );

  -- Step 3: Notification — Consultant gets notified
  INSERT INTO notifications (recipient_id, type, message)
  VALUES (
    p_consultant_id,
    'LEAD_ASSIGNED',
    'You have been assigned a new lead: ' || _lead.customer_name || ' (' || coalesce(_lead.city, 'unknown city') || ')'
  );

  -- Return the updated lead as JSONB
  SELECT to_jsonb(l.*) INTO _result
  FROM leads l WHERE l.lead_id = p_lead_id;

  RETURN _result;
END;
$$;

-- Grant execute to authenticated (Edge Functions call as the authenticated user's session)
GRANT EXECUTE ON FUNCTION assign_lead_to_consultant(UUID, UUID, UUID) TO authenticated;

-- Grant to service_role for testing and Edge Function service-role calls
GRANT EXECUTE ON FUNCTION assign_lead_to_consultant(UUID, UUID, UUID) TO service_role;
