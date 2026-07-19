-- PERFECCITY MVP — Migration 00010: Atomic space replacement RPC
-- Source: Sprint 2 T5; AD-19 (space replacement atomicity)
--
-- WHY THIS EXISTS:
-- Stage 4's "full replacement" (delete old spaces, insert new) was two separate
-- round-trips from the Edge Function. If delete succeeds but insert fails
-- (constraint violation, network blip), the project is left with ZERO spaces —
-- worse than either old or new state, and silent unless something checks for it.
-- This is the same partial-failure category as T2's compensating-delete pattern.
--
-- RESOLUTION: Postgres function wrapping both operations in one transaction.
-- If the insert fails, the delete is also rolled back (Postgres transactional
-- semantics). The project never loses its spaces.
--
-- Pattern: consistent with assign_lead_to_consultant (T7/AD-5/AD-6).
-- SECURITY DEFINER + SET search_path = public.

CREATE OR REPLACE FUNCTION replace_project_spaces(
  p_project_id UUID,
  p_spaces JSONB  -- array of {space_type, wall_shape, is_primary_wall, ...}
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _space JSONB;
  _inserted JSONB;
  _results JSONB := '[]'::JSONB;
  _space_row RECORD;
BEGIN
  -- Delete all existing spaces for this project (within this transaction)
  DELETE FROM application_spaces WHERE project_id = p_project_id;

  -- Insert each new space
  FOR _space IN SELECT * FROM jsonb_array_elements(p_spaces)
  LOOP
    INSERT INTO application_spaces (
      project_id, space_type, wall_shape, is_primary_wall,
      primary_parameter_value, planning_notes, width_mm, height_mm
    ) VALUES (
      p_project_id,
      (_space->>'space_type')::space_type_enum,
      CASE WHEN _space->>'wall_shape' IS NOT NULL
           THEN (_space->>'wall_shape')::wall_shape_enum
           ELSE NULL END,
      (_space->>'is_primary_wall')::BOOLEAN,
      _space->>'primary_parameter_value',
      _space->>'planning_notes',
      CASE WHEN _space->>'width_mm' IS NOT NULL
           THEN (_space->>'width_mm')::INTEGER
           ELSE NULL END,
      CASE WHEN _space->>'height_mm' IS NOT NULL
           THEN (_space->>'height_mm')::INTEGER
           ELSE NULL END
    )
    RETURNING to_jsonb(application_spaces.*) INTO _inserted;

    _results := _results || _inserted;
  END LOOP;

  -- If we get here, all inserts succeeded — transaction commits atomically.
  -- If any insert fails (constraint violation, enum cast error), the entire
  -- transaction rolls back including the DELETE — project keeps old spaces.
  RETURN _results;
END;
$$;

-- ⚠️ CO-MAINTENANCE: This function is called by
-- supabase/functions/api-consultation/stage-4.ts (handleStage4).
-- Changes to parameter shape must be reflected there.

GRANT EXECUTE ON FUNCTION replace_project_spaces(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION replace_project_spaces(UUID, JSONB) TO service_role;
