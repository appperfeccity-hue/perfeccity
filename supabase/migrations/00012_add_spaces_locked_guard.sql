-- PERFECCITY MVP — Migration 00012: Add SPACES_LOCKED guard to replace_project_spaces
-- Source: Sprint 4 T0; AD-19 Sprint 2 Pending dependency, now resolved.
--
-- CONTEXT: Sprint 2 identified that replace_project_spaces (migration 00010) does
-- a bare DELETE on application_spaces. Once Sprint 4+ populates child tables
-- (space_configurations, space_measurements, configured_furniture, space_design_overrides,
-- configuration_line_items, bom_lines), the DELETE will FK-fail.
--
-- RESOLUTION: Guard at the top of the function that checks for downstream data BEFORE
-- attempting the DELETE. If any space for this project has child rows → reject with
-- a clear error. Stage 4 resubmission is only allowed while spaces are "clean"
-- (no configurations, measurements, or furniture attached yet).
--
-- This is structurally correct: once Stage 5+ runs (template selection, measurements,
-- engine), the spaces are frozen. Resubmitting Stage 4 at that point would mean
-- discarding all configuration work — which is NOT what a Consultant intends when
-- editing spaces mid-flow. The correct action is to start over (which the spec
-- doesn't support in MVP — Part 1 Immutability Rule).

CREATE OR REPLACE FUNCTION replace_project_spaces(
  p_project_id UUID,
  p_spaces JSONB
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
  _downstream_count INTEGER;
BEGIN
  -- GUARD: Check for downstream data that would FK-fail on DELETE.
  -- If any space for this project has child rows, reject the replacement.
  -- This resolves the Sprint 2 Pending dependency (AD-19 FK cascade).
  SELECT COUNT(*) INTO _downstream_count
  FROM application_spaces s
  WHERE s.project_id = p_project_id
    AND (
      EXISTS (SELECT 1 FROM space_configurations sc WHERE sc.space_id = s.space_id)
      OR EXISTS (SELECT 1 FROM space_measurements sm WHERE sm.space_id = s.space_id)
      OR EXISTS (SELECT 1 FROM configured_furniture cf WHERE cf.space_id = s.space_id)
      OR EXISTS (SELECT 1 FROM space_design_overrides sdo WHERE sdo.space_id = s.space_id)
    );

  IF _downstream_count > 0 THEN
    -- ⚠️ CO-MAINTENANCE: matched by supabase/functions/api-consultation/stage-4.ts
    RAISE EXCEPTION 'SPACES_LOCKED_BY_CONFIGURATION'
      USING ERRCODE = 'P0020',
            HINT = 'Cannot replace spaces: ' || _downstream_count ||
                   ' space(s) have downstream data (configurations, measurements, or furniture). ' ||
                   'Stage 4 cannot be resubmitted once Stage 5+ has been accessed.';
  END IF;

  -- (Rest of function unchanged from migration 00010)

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

  RETURN _results;
END;
$$;

-- Grants already exist from 00010 (CREATE OR REPLACE doesn't drop them).
-- Re-grant for safety in case the function was dropped and recreated:
GRANT EXECUTE ON FUNCTION replace_project_spaces(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION replace_project_spaces(UUID, JSONB) TO service_role;
