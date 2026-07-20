-- Migration 00021: Sprint 7 RPCs — State transitions + Installation lifecycle
-- Per pre-write checklist: SECURITY DEFINER + SET search_path + GRANT.

-- ============================================================
-- RPC: transition_project_status
-- Generic state machine for post-payment transitions.
-- Validates allowed transitions and guards.
-- ============================================================

CREATE OR REPLACE FUNCTION public.transition_project_status(
  p_project_id UUID,
  p_to_status  project_status_enum,
  p_actor_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status TEXT;
  v_package_status TEXT;
BEGIN
  -- Get current status
  SELECT status INTO v_current_status
    FROM projects WHERE project_id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROJECT_NOT_FOUND: %', p_project_id;
  END IF;

  -- Validate allowed transitions
  CASE
    WHEN v_current_status = 'APPROVED' AND p_to_status = 'ORDERED' THEN
      -- Guard: PACKAGE_NOT_READY
      SELECT status INTO v_package_status
        FROM manufacturing_packages
       WHERE project_id = p_project_id
         AND status = 'READY'
       LIMIT 1;

      IF v_package_status IS NULL THEN
        RAISE EXCEPTION 'PACKAGE_NOT_READY: Manufacturing package must be READY before transitioning to ORDERED';
        -- ⚠️ CO-MAINTENANCE: matched by supabase/functions/api-project-transition/index.ts
      END IF;

    WHEN v_current_status = 'ORDERED' AND p_to_status = 'IN_PRODUCTION' THEN
      -- No additional guard — Manager confirms production started
      NULL;

    WHEN v_current_status = 'IN_PRODUCTION' AND p_to_status = 'INSTALLATION_SCHEDULED' THEN
      -- Guard: installation must be scheduled
      IF NOT EXISTS (
        SELECT 1 FROM installation_schedules
        WHERE project_id = p_project_id
          AND status IN ('CONFIRMED', 'RESCHEDULED')
      ) THEN
        RAISE EXCEPTION 'INSTALLATION_NOT_SCHEDULED: An installation must be scheduled before this transition';
      END IF;

    ELSE
      RAISE EXCEPTION 'INVALID_TRANSITION: Cannot transition from % to %', v_current_status, p_to_status;
      -- ⚠️ CO-MAINTENANCE: matched by supabase/functions/api-project-transition/index.ts
  END CASE;

  -- Execute transition
  UPDATE projects
     SET status = p_to_status,
         updated_at = now()
   WHERE project_id = p_project_id;

  -- Record state history
  INSERT INTO project_state_history (project_id, from_status, to_status, actor_id, trigger_rule)
  VALUES (p_project_id, v_current_status::project_status_enum, p_to_status, p_actor_id, 'manual_transition');

  RETURN jsonb_build_object(
    'project_id', p_project_id,
    'from_status', v_current_status,
    'to_status', p_to_status,
    'transitioned_by', p_actor_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.transition_project_status(UUID, project_status_enum, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_project_status(UUID, project_status_enum, UUID) TO service_role;

-- ============================================================
-- RPC: schedule_installation (WF-7)
-- Creates the first installation schedule for a project.
-- ============================================================

CREATE OR REPLACE FUNCTION public.schedule_installation(
  p_project_id    UUID,
  p_manager_id    UUID,
  p_date          DATE,
  p_slot          installation_slot_enum,
  p_notes         TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_status TEXT;
  v_schedule_id UUID;
BEGIN
  -- Guard: project must be APPROVED or later
  SELECT status INTO v_project_status
    FROM projects WHERE project_id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROJECT_NOT_FOUND: %', p_project_id;
  END IF;

  IF v_project_status NOT IN ('APPROVED', 'ORDERED', 'IN_PRODUCTION') THEN
    RAISE EXCEPTION 'PAYMENT_NOT_CONFIRMED: Project must be APPROVED (or later) to schedule installation (current: %)', v_project_status;
    -- ⚠️ CO-MAINTENANCE: matched by supabase/functions/api-installation/index.ts
  END IF;

  -- Guard: package must be READY
  IF NOT EXISTS (
    SELECT 1 FROM manufacturing_packages
    WHERE project_id = p_project_id AND status = 'READY'
  ) THEN
    RAISE EXCEPTION 'PACKAGE_NOT_READY: Manufacturing package must be READY before scheduling';
  END IF;

  -- Guard: date must be in the future
  IF p_date <= CURRENT_DATE THEN
    RAISE EXCEPTION 'INVALID_DATE: Installation date must be in the future';
  END IF;

  -- Insert schedule (UNIQUE constraint on project_id will prevent duplicates)
  INSERT INTO installation_schedules (project_id, manager_id, scheduled_date, scheduled_slot, notes)
  VALUES (p_project_id, p_manager_id, p_date, p_slot, p_notes)
  RETURNING id INTO v_schedule_id;

  -- Update project pointer
  UPDATE projects
     SET latest_installation_schedule_id = v_schedule_id,
         installation_scheduled_date = p_date,
         updated_at = now()
   WHERE project_id = p_project_id;

  -- Notification: customer
  INSERT INTO notifications (recipient_id, type, message)
  SELECT cpl.customer_id, 'INSTALLATION_SCHEDULED',
         'Your installation has been scheduled for ' || p_date::TEXT || ' (' || p_slot::TEXT || ')'
    FROM customer_project_links cpl
   WHERE cpl.project_id = p_project_id
   LIMIT 1;

  RETURN jsonb_build_object(
    'schedule_id', v_schedule_id,
    'project_id', p_project_id,
    'date', p_date,
    'slot', p_slot,
    'status', 'CONFIRMED'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.schedule_installation(UUID, UUID, DATE, installation_slot_enum, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_installation(UUID, UUID, DATE, installation_slot_enum, TEXT) TO service_role;

-- ============================================================
-- RPC: complete_installation (WF-9)
-- Atomic: project.status → CLOSED + installation_schedules.status → COMPLETED
-- ============================================================

CREATE OR REPLACE FUNCTION public.complete_installation(
  p_project_id UUID,
  p_actor_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status TEXT;
  v_schedule RECORD;
BEGIN
  -- Get project status
  SELECT status INTO v_current_status
    FROM projects WHERE project_id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROJECT_NOT_FOUND: %', p_project_id;
  END IF;

  -- Guard: project must be INSTALLATION_SCHEDULED
  IF v_current_status != 'INSTALLATION_SCHEDULED' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Project must be INSTALLATION_SCHEDULED to complete (current: %)', v_current_status;
  END IF;

  -- Get the installation schedule
  SELECT id, status INTO v_schedule
    FROM installation_schedules
   WHERE project_id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_SCHEDULE: No installation schedule found for this project';
  END IF;

  -- Guard: schedule must be CONFIRMED or RESCHEDULED (not already COMPLETED)
  IF v_schedule.status NOT IN ('CONFIRMED', 'RESCHEDULED') THEN
    RAISE EXCEPTION 'INSTALLATION_ALREADY_COMPLETED: Installation is already %', v_schedule.status;
  END IF;

  -- Atomic: project → CLOSED + schedule → COMPLETED
  UPDATE projects
     SET status = 'CLOSED',
         updated_at = now()
   WHERE project_id = p_project_id;

  UPDATE installation_schedules
     SET status = 'COMPLETED',
         updated_at = now()
   WHERE id = v_schedule.id;

  -- State history
  INSERT INTO project_state_history (project_id, from_status, to_status, actor_id, trigger_rule)
  VALUES (p_project_id, v_current_status::project_status_enum, 'CLOSED', p_actor_id, 'installation_completed');

  RETURN jsonb_build_object(
    'project_id', p_project_id,
    'from_status', v_current_status,
    'to_status', 'CLOSED',
    'schedule_status', 'COMPLETED'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_installation(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_installation(UUID, UUID) TO service_role;
