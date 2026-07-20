-- Migration 00020: Add state transition + history to persist_quotation_snapshot
--
-- PROBLEM: persist_quotation_snapshot (migration 00015) updates
-- latest_snapshot_id but does NOT transition project.status to QUOTED
-- or write project_state_history. This means a direct RPC caller (admin tool,
-- retry script, test) can create a sealed snapshot while the project stays
-- in REVIEWED with no audit trail of the transition.
--
-- FIX: Add REVIEWED→QUOTED transition + state_history write INTO the RPC,
-- making it impossible to persist a sealed quotation without the corresponding
-- audit entry. Same pattern as submit_review_gate (which internally transitions
-- CONFIGURING→REVIEWED + writes history).
--
-- IDEMPOTENT: If project is already QUOTED (re-quote path), skip the transition
-- but still update latest_snapshot_id (the new snapshot replaces the old).

CREATE OR REPLACE FUNCTION public.persist_quotation_snapshot(
  p_project_id       UUID,
  p_grand_total_paise BIGINT,
  p_step_breakdown   JSONB,
  p_sha256_hash      VARCHAR,
  p_seal_payload     JSONB,
  p_generated_by     UUID,
  p_bom_lines        JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot_id UUID;
  v_sealed_at   TIMESTAMPTZ := now();
  v_expires_at  TIMESTAMPTZ;
  v_line        JSONB;
  v_line_count  INTEGER := 0;
  v_current_status TEXT;
BEGIN
  -- Guard: project must exist
  SELECT status INTO v_current_status
    FROM projects WHERE project_id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROJECT_NOT_FOUND: %', p_project_id;
    -- ⚠️ CO-MAINTENANCE: matched by supabase/functions/api-quotation/index.ts
  END IF;

  -- Guard: sha256_hash format
  IF length(p_sha256_hash) != 64 OR p_sha256_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_SEAL_HASH: sha256_hash must be 64 lowercase hex characters (got length %)', length(p_sha256_hash);
    -- ⚠️ CO-MAINTENANCE: matched by supabase/functions/api-quotation/index.ts
  END IF;

  -- Guard: bom_lines non-empty
  IF p_bom_lines IS NULL OR jsonb_array_length(p_bom_lines) = 0 THEN
    RAISE EXCEPTION 'EMPTY_BOM_LINES: At least one bom_line is required';
    -- ⚠️ CO-MAINTENANCE: matched by supabase/functions/api-quotation/index.ts
  END IF;

  -- Compute expiry
  v_expires_at := v_sealed_at + INTERVAL '7 days';

  -- Step 1: Insert quotation_snapshots row (status = SEALED)
  INSERT INTO quotation_snapshots (
    project_id, status, grand_total_paise, step_breakdown,
    sha256_hash, seal_payload, sealed_at, expires_at, generated_by
  ) VALUES (
    p_project_id, 'SEALED', p_grand_total_paise, p_step_breakdown,
    p_sha256_hash, p_seal_payload, v_sealed_at, v_expires_at, p_generated_by
  )
  RETURNING snapshot_id INTO v_snapshot_id;

  -- Step 2: Insert bom_lines
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_bom_lines)
  LOOP
    INSERT INTO bom_lines (
      project_id, snapshot_id, space_id, furniture_id, sku,
      source, component_label, quantity, unit_label, unit_cost_paise, line_total_paise
    ) VALUES (
      p_project_id,
      v_snapshot_id,
      (v_line ->> 'space_id')::UUID,
      (v_line ->> 'furniture_id')::UUID,
      v_line ->> 'sku',
      (v_line ->> 'source')::bom_source_enum,
      v_line ->> 'component_label',
      (v_line ->> 'quantity')::NUMERIC,
      v_line ->> 'unit_label',
      (v_line ->> 'unit_cost_paise')::BIGINT,
      (v_line ->> 'line_total_paise')::BIGINT
    );
    v_line_count := v_line_count + 1;
  END LOOP;

  -- Step 3: Update project pointer + transition status to QUOTED
  -- Idempotent: if already QUOTED (re-quote after expiry), just update the pointer
  IF v_current_status = 'REVIEWED' THEN
    UPDATE projects
       SET status = 'QUOTED',
           latest_snapshot_id = v_snapshot_id,
           updated_at = now()
     WHERE project_id = p_project_id;

    -- Audit trail: state transition (REVIEWED → QUOTED)
    INSERT INTO project_state_history (project_id, from_status, to_status, actor_id, trigger_rule)
    VALUES (p_project_id, 'REVIEWED', 'QUOTED', p_generated_by, 'quotation_sealed');
  ELSE
    -- Re-quote or other path: just update the pointer, don't change status
    UPDATE projects
       SET latest_snapshot_id = v_snapshot_id,
           updated_at = now()
     WHERE project_id = p_project_id;
  END IF;

  RETURN jsonb_build_object(
    'snapshot_id', v_snapshot_id,
    'sealed_at', v_sealed_at,
    'expires_at', v_expires_at,
    'bom_line_count', v_line_count,
    'sha256_hash', p_sha256_hash,
    'status_transitioned', v_current_status = 'REVIEWED'
  );
END;
$$;

-- Grants unchanged (CREATE OR REPLACE preserves them, but re-state for clarity)
GRANT EXECUTE ON FUNCTION public.persist_quotation_snapshot(UUID, BIGINT, JSONB, VARCHAR, JSONB, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.persist_quotation_snapshot(UUID, BIGINT, JSONB, VARCHAR, JSONB, UUID, JSONB) TO service_role;
