-- Migration 00022: Installation Rescheduling RPCs (Sprint 7 T4, WF-8)
-- Per pre-write checklist: SECURITY DEFINER + SET search_path + GRANT.

-- ============================================================
-- RPC: request_reschedule (Customer action via magic link)
-- 4 guards in order per WF-8 specification.
-- ============================================================

CREATE OR REPLACE FUNCTION public.request_reschedule(
  p_project_id UUID,
  p_reason     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_status TEXT;
  v_schedule RECORD;
BEGIN
  -- Get project status
  SELECT status INTO v_project_status
    FROM projects WHERE project_id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROJECT_NOT_FOUND: %', p_project_id;
  END IF;

  -- Guard 1: PROJECT_CLOSED
  IF v_project_status = 'CLOSED' THEN
    RAISE EXCEPTION 'PROJECT_CLOSED: Cannot reschedule a closed project';
    -- ⚠️ CO-MAINTENANCE: matched by customer-portal reschedule endpoint
  END IF;

  -- Get installation schedule
  SELECT id, status, scheduled_date INTO v_schedule
    FROM installation_schedules
   WHERE project_id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_SCHEDULE: No installation schedule exists for this project';
  END IF;

  -- Guard 2: INSTALLATION_ALREADY_COMPLETED
  IF v_schedule.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'INSTALLATION_ALREADY_COMPLETED: Cannot reschedule a completed installation';
  END IF;

  -- Guard 3: TOO_LATE_TO_RESCHEDULE (< 48 hours away)
  IF v_schedule.scheduled_date <= (CURRENT_DATE + INTERVAL '2 days')::DATE THEN
    RAISE EXCEPTION 'TOO_LATE_TO_RESCHEDULE: Installation is less than 48 hours away';
  END IF;

  -- Guard 4: RESCHEDULE_ALREADY_PENDING
  IF v_schedule.status = 'RESCHEDULE_REQUESTED' THEN
    RAISE EXCEPTION 'RESCHEDULE_ALREADY_PENDING: A reschedule request is already pending';
  END IF;

  -- All guards passed — transition to RESCHEDULE_REQUESTED
  UPDATE installation_schedules
     SET status = 'RESCHEDULE_REQUESTED',
         updated_at = now()
   WHERE id = v_schedule.id;

  -- Append to reschedule log
  INSERT INTO installation_reschedule_log (project_id, old_date, old_slot, requested_by, reason)
  SELECT p_project_id, v_schedule.scheduled_date, is2.scheduled_slot, 'CUSTOMER', p_reason
    FROM installation_schedules is2 WHERE is2.id = v_schedule.id;

  -- Notify Manager
  INSERT INTO notifications (recipient_id, type, message)
  SELECT p.manager_id, 'RESCHEDULE_REQUESTED',
         'Reschedule requested for project ' || p_project_id
    FROM projects p
   WHERE p.project_id = p_project_id
     AND p.manager_id IS NOT NULL;

  RETURN jsonb_build_object(
    'project_id', p_project_id,
    'status', 'RESCHEDULE_REQUESTED',
    'message', 'Reschedule request submitted. Your manager will confirm shortly.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_reschedule(UUID, TEXT) TO service_role;

-- ============================================================
-- RPC: approve_reschedule (Manager action)
-- ============================================================

CREATE OR REPLACE FUNCTION public.approve_reschedule(
  p_project_id UUID,
  p_new_date   DATE,
  p_new_slot   installation_slot_enum,
  p_actor_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule RECORD;
BEGIN
  -- Get schedule
  SELECT id, status, scheduled_date, scheduled_slot INTO v_schedule
    FROM installation_schedules
   WHERE project_id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_SCHEDULE: No installation schedule exists for this project';
  END IF;

  -- Must be in RESCHEDULE_REQUESTED state
  IF v_schedule.status != 'RESCHEDULE_REQUESTED' THEN
    RAISE EXCEPTION 'NO_PENDING_RESCHEDULE: Schedule is not in RESCHEDULE_REQUESTED state (current: %)', v_schedule.status;
  END IF;

  -- Date must be in the future
  IF p_new_date <= CURRENT_DATE THEN
    RAISE EXCEPTION 'INVALID_DATE: New installation date must be in the future';
  END IF;

  -- Update schedule: status → RESCHEDULED, new date/slot
  UPDATE installation_schedules
     SET status = 'RESCHEDULED',
         scheduled_date = p_new_date,
         scheduled_slot = p_new_slot,
         updated_at = now()
   WHERE id = v_schedule.id;

  -- Update project pointer
  UPDATE projects
     SET installation_scheduled_date = p_new_date,
         updated_at = now()
   WHERE project_id = p_project_id;

  -- Append to reschedule log
  INSERT INTO installation_reschedule_log (project_id, old_date, old_slot, new_date, new_slot, requested_by, actor_id)
  VALUES (p_project_id, v_schedule.scheduled_date, v_schedule.scheduled_slot, p_new_date, p_new_slot, 'MANAGER', p_actor_id);

  -- Notify Consultant (who relays to customer via WhatsApp)
  INSERT INTO notifications (recipient_id, type, message)
  SELECT p.consultant_id, 'RESCHEDULE_APPROVED',
         'Reschedule approved for project ' || p_project_id || '. New date: ' || p_new_date::TEXT || ' (' || p_new_slot::TEXT || ')'
    FROM projects p
   WHERE p.project_id = p_project_id;

  RETURN jsonb_build_object(
    'project_id', p_project_id,
    'status', 'RESCHEDULED',
    'new_date', p_new_date,
    'new_slot', p_new_slot
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_reschedule(UUID, DATE, installation_slot_enum, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_reschedule(UUID, DATE, installation_slot_enum, UUID) TO service_role;

-- ============================================================
-- RPC: reject_reschedule (Manager action)
-- ============================================================

CREATE OR REPLACE FUNCTION public.reject_reschedule(
  p_project_id UUID,
  p_reason     TEXT,
  p_actor_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule RECORD;
  v_prior_status installation_schedule_status_enum;
BEGIN
  -- Reason is required
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: A reason must be provided when rejecting a reschedule';
  END IF;

  -- Get schedule
  SELECT id, status, scheduled_date, scheduled_slot INTO v_schedule
    FROM installation_schedules
   WHERE project_id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_SCHEDULE: No installation schedule exists for this project';
  END IF;

  -- Must be in RESCHEDULE_REQUESTED state
  IF v_schedule.status != 'RESCHEDULE_REQUESTED' THEN
    RAISE EXCEPTION 'NO_PENDING_RESCHEDULE: Schedule is not in RESCHEDULE_REQUESTED state (current: %)', v_schedule.status;
  END IF;

  -- Revert to prior status (CONFIRMED or RESCHEDULED — determine from log)
  -- Per WF-8: "status reverts to its prior value"
  -- If this was the first reschedule request on a CONFIRMED schedule, revert to CONFIRMED
  -- If it was on a RESCHEDULED schedule (second+ request), revert to RESCHEDULED
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM installation_reschedule_log
      WHERE project_id = p_project_id AND requested_by = 'MANAGER'
    ) THEN 'RESCHEDULED'::installation_schedule_status_enum
    ELSE 'CONFIRMED'::installation_schedule_status_enum
  END INTO v_prior_status;

  -- Revert status, keep original date/slot unchanged
  UPDATE installation_schedules
     SET status = v_prior_status,
         updated_at = now()
   WHERE id = v_schedule.id;

  -- Append to reschedule log
  INSERT INTO installation_reschedule_log (project_id, old_date, requested_by, reason, actor_id)
  VALUES (p_project_id, v_schedule.scheduled_date, 'MANAGER', p_reason, p_actor_id);

  -- Notify Consultant (who relays rejection reason to customer)
  INSERT INTO notifications (recipient_id, type, message)
  SELECT p.consultant_id, 'RESCHEDULE_REJECTED',
         'Reschedule rejected for project ' || p_project_id || '. Reason: ' || p_reason
    FROM projects p
   WHERE p.project_id = p_project_id;

  RETURN jsonb_build_object(
    'project_id', p_project_id,
    'status', v_prior_status,
    'reason', p_reason,
    'message', 'Reschedule request rejected. Original date maintained.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_reschedule(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_reschedule(UUID, TEXT, UUID) TO service_role;
