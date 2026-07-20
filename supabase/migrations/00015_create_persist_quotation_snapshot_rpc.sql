-- Migration 00015: Persist Quotation Snapshot RPC (Sprint 5 T4)
-- Atomic function: inserts quotation_snapshots + bom_lines + seal in one transaction.
-- Per pre-write checklist: SECURITY DEFINER + SET search_path + GRANT.
--
-- ATOMICITY GUARANTEE: If any bom_line insert fails (FK violation, type mismatch),
-- the entire transaction rolls back — no orphaned snapshot without its bom_lines,
-- no bom_lines pointing to a non-existent snapshot. This is the highest-stakes
-- atomicity case in the build (a snapshot without matching bom_lines, or seal_payload
-- that doesn't match what's in bom_lines, is commercially/legally broken).
--
-- SEAL INTEGRITY: seal_payload is stored as JSONB (parsed by Postgres).
-- The sha256_hash is computed from the CANONICAL form of the payload (sorted keys,
-- no whitespace). Verification path: read JSONB → re-canonicalize → SHA-256 → compare.
-- This is documented and tested (T5 acceptance test).

-- ============================================================
-- RPC: persist_quotation_snapshot
-- Called after the 13-step engine completes (via Edge Function or RPC chain)
-- ============================================================

CREATE OR REPLACE FUNCTION public.persist_quotation_snapshot(
  p_project_id       UUID,
  p_grand_total_paise BIGINT,
  p_step_breakdown   JSONB,
  p_sha256_hash      VARCHAR,
  p_seal_payload     JSONB,
  p_generated_by     UUID,
  p_bom_lines        JSONB   -- array of bom_line objects
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
BEGIN
  -- -------------------------------------------------------
  -- Guard: project must exist
  -- -------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM projects WHERE project_id = p_project_id) THEN
    RAISE EXCEPTION 'PROJECT_NOT_FOUND: %', p_project_id;
    -- ⚠️ CO-MAINTENANCE: matched by supabase/functions/api-quotation/index.ts
  END IF;

  -- -------------------------------------------------------
  -- Guard: sha256_hash must be exactly 64 hex characters
  -- -------------------------------------------------------
  IF length(p_sha256_hash) != 64 OR p_sha256_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_SEAL_HASH: sha256_hash must be 64 lowercase hex characters (got length %)', length(p_sha256_hash);
    -- ⚠️ CO-MAINTENANCE: matched by supabase/functions/api-quotation/index.ts
  END IF;

  -- -------------------------------------------------------
  -- Guard: bom_lines must be a non-empty array
  -- -------------------------------------------------------
  IF p_bom_lines IS NULL OR jsonb_array_length(p_bom_lines) = 0 THEN
    RAISE EXCEPTION 'EMPTY_BOM_LINES: At least one bom_line is required';
    -- ⚠️ CO-MAINTENANCE: matched by supabase/functions/api-quotation/index.ts
  END IF;

  -- -------------------------------------------------------
  -- Compute expiry (sealed_at + 7 days, per R4)
  -- -------------------------------------------------------
  v_expires_at := v_sealed_at + INTERVAL '7 days';

  -- -------------------------------------------------------
  -- Step 1: Insert quotation_snapshots row (status = SEALED)
  -- The snapshot is created in SEALED state because we have the
  -- complete engine output + seal at this point.
  -- -------------------------------------------------------
  INSERT INTO quotation_snapshots (
    project_id,
    status,
    grand_total_paise,
    step_breakdown,
    sha256_hash,
    seal_payload,
    sealed_at,
    expires_at,
    generated_by
  ) VALUES (
    p_project_id,
    'SEALED',
    p_grand_total_paise,
    p_step_breakdown,
    p_sha256_hash,
    p_seal_payload,
    v_sealed_at,
    v_expires_at,
    p_generated_by
  )
  RETURNING snapshot_id INTO v_snapshot_id;

  -- -------------------------------------------------------
  -- Step 2: Insert all bom_lines for this snapshot
  -- Each line references the newly created snapshot_id.
  -- FK constraints (sku → product_library, space_id → application_spaces)
  -- will enforce referential integrity. A violation here rolls back
  -- the entire transaction (including the snapshot insert above).
  -- -------------------------------------------------------
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_bom_lines)
  LOOP
    INSERT INTO bom_lines (
      project_id,
      snapshot_id,
      space_id,
      furniture_id,
      sku,
      source,
      component_label,
      quantity,
      unit_label,
      unit_cost_paise,
      line_total_paise
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

  -- -------------------------------------------------------
  -- Step 3: Update project's latest_snapshot_id pointer
  -- -------------------------------------------------------
  UPDATE projects
     SET latest_snapshot_id = v_snapshot_id,
         updated_at = now()
   WHERE project_id = p_project_id;

  -- -------------------------------------------------------
  -- Return result
  -- -------------------------------------------------------
  RETURN jsonb_build_object(
    'snapshot_id', v_snapshot_id,
    'sealed_at', v_sealed_at,
    'expires_at', v_expires_at,
    'bom_line_count', v_line_count,
    'sha256_hash', p_sha256_hash
  );
END;
$$;

-- Grants (per pre-write checklist)
GRANT EXECUTE ON FUNCTION public.persist_quotation_snapshot(UUID, BIGINT, JSONB, VARCHAR, JSONB, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.persist_quotation_snapshot(UUID, BIGINT, JSONB, VARCHAR, JSONB, UUID, JSONB) TO service_role;
