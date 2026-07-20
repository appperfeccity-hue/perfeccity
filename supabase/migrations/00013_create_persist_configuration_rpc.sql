-- PERFECCITY MVP — Migration 00013: Persist Configuration RPC (R9 + line items)
-- Source: Sprint 4 T9; Part 8 (R9: archive old config, insert new)
--
-- WHY THIS EXISTS:
-- Stage 7's measurement submission triggers the Configuration Engine, which
-- produces a set of line items and a configuration_hash. Persisting the result
-- requires 3 operations that must be atomic:
-- 1. Archive old config: SET is_current=FALSE on existing current config
-- 2. Insert new config: new space_configurations row with is_current=TRUE
-- 3. Insert line items: all configuration_line_items rows for this config
--
-- If these are separate calls:
-- - Archive succeeds + insert fails → zero current configs (limbo state)
-- - Config inserts + line_items fail → config exists with no line items
--   (hash was computed from items that don't exist in DB — hash is meaningless)
--
-- Both are worse-than-either states → RPC required (same discipline as AD-19).
--
-- Pre-write checklist applied:
-- ✅ SECURITY DEFINER + SET search_path = public (AD-5)
-- ✅ GRANT EXECUTE TO authenticated, service_role (AD-11)
-- ✅ Atomic: all 3 operations in one transaction
-- ✅ one_current_config_per_space: only one row with is_current=TRUE per space
--    at any time (partial unique index in 00005 enforces)

CREATE OR REPLACE FUNCTION persist_configuration(
  p_space_id UUID,
  p_project_id UUID,
  p_template_id UUID,
  p_installation_type installation_type_enum,
  p_back_board_mm SMALLINT,
  p_configuration_hash VARCHAR,
  p_generated_by VARCHAR,
  p_line_items JSONB  -- array of {sku, product_role, quantity, unit_label, unit_cost_paise, sell_price_paise, group_name, generated_by_rule}
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_config_id UUID;
  _item JSONB;
  _result JSONB;
BEGIN
  -- Step 1: Archive old config (R9: set is_current=FALSE)
  -- Only updates rows for this specific space — doesn't touch other spaces
  UPDATE space_configurations
  SET is_current = FALSE
  WHERE space_id = p_space_id
    AND is_current = TRUE;

  -- Step 2: Insert new config with is_current=TRUE
  INSERT INTO space_configurations (
    space_id, project_id, template_id, installation_type,
    back_board_mm, configuration_hash, is_current, generated_by, generated_at
  ) VALUES (
    p_space_id, p_project_id, p_template_id, p_installation_type,
    p_back_board_mm, p_configuration_hash, TRUE, p_generated_by, now()
  )
  RETURNING config_id INTO _new_config_id;

  -- Step 3: Insert all configuration_line_items for this config
  FOR _item IN SELECT * FROM jsonb_array_elements(p_line_items)
  LOOP
    INSERT INTO configuration_line_items (
      config_id, project_id, space_id, sku, product_role,
      quantity, unit_label, unit_cost_paise, sell_price_paise,
      group_name, generated_by_rule
    ) VALUES (
      _new_config_id,
      p_project_id,
      p_space_id,
      _item->>'sku',
      (_item->>'product_role')::product_role_enum,
      (_item->>'quantity')::DECIMAL,
      _item->>'unit_label',
      (_item->>'unit_cost_paise')::BIGINT,
      (_item->>'sell_price_paise')::BIGINT,
      (_item->>'group_name')::bom_source_enum,
      _item->>'generated_by_rule'
    );
  END LOOP;

  -- If we get here, all operations succeeded atomically.
  -- If any INSERT fails, the entire transaction rolls back:
  -- - The archive (step 1) is undone → old config stays is_current=TRUE
  -- - The new config (step 2) is undone → no orphaned config row
  -- - No partial line_items exist

  -- Return the new config details
  SELECT to_jsonb(sc.*) INTO _result
  FROM space_configurations sc
  WHERE sc.config_id = _new_config_id;

  _result := jsonb_set(_result, '{config_id}', to_jsonb(_new_config_id::TEXT));

  RETURN _result;
END;
$$;

-- ⚠️ CO-MAINTENANCE: This function is called by the Stage 7 measurement
-- endpoint (supabase/functions/api-consultation/stage-7.ts).
-- Changes to parameter shape must be reflected there.

GRANT EXECUTE ON FUNCTION persist_configuration(UUID, UUID, UUID, installation_type_enum, SMALLINT, VARCHAR, VARCHAR, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION persist_configuration(UUID, UUID, UUID, installation_type_enum, SMALLINT, VARCHAR, VARCHAR, JSONB) TO service_role;
