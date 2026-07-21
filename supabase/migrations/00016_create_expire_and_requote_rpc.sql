-- Migration 00016: Quotation Expiry + Re-quote RPCs (Sprint 5 T6)
--
-- Two operations:
-- 1. expire_quotation_snapshot: marks SEALED → EXPIRED (time-based, no payment received)
-- 2. The re-quote path is handled by the calling code:
--    a. Call expire_quotation_snapshot (if not already expired)
--    b. Rerun 13-step engine with current SKU prices
--    c. Call persist_quotation_snapshot (creates new snapshot + new seal)
--
-- The old snapshot STAYS INTACT with its original seal (AD-32: sealed = immutable).
-- A failed payment attempt does NOT trigger expiry (R5 spec: "same snapshot, retry").
--
-- Per pre-write checklist: SECURITY DEFINER + SET search_path + GRANT.

-- ============================================================
-- RPC: expire_quotation_snapshot
-- Transitions a SEALED snapshot to EXPIRED.
-- Called either by a scheduled job (cron) or by the re-quote flow.
-- ============================================================

CREATE OR REPLACE FUNCTION public.expire_quotation_snapshot(
  p_snapshot_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot RECORD;
BEGIN
  -- -------------------------------------------------------
  -- Guard: snapshot must exist
  -- -------------------------------------------------------
  SELECT snapshot_id, project_id, status, sealed_at, expires_at
    INTO v_snapshot
    FROM quotation_snapshots
   WHERE snapshot_id = p_snapshot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SNAPSHOT_NOT_FOUND: %', p_snapshot_id;
    -- ⚠️ CO-MAINTENANCE: matched by supabase/functions/api-quotation/index.ts
  END IF;

  -- -------------------------------------------------------
  -- Guard: only SEALED snapshots can expire
  -- Already-EXPIRED or ARCHIVED snapshots are rejected.
  -- -------------------------------------------------------
  IF v_snapshot.status != 'SEALED' THEN
    RAISE EXCEPTION 'INVALID_SNAPSHOT_STATUS: Only SEALED snapshots can expire (current: %)', v_snapshot.status;
    -- ⚠️ CO-MAINTENANCE: matched by supabase/functions/api-quotation/index.ts
  END IF;

  -- -------------------------------------------------------
  -- Transition: SEALED → EXPIRED
  -- The snapshot row itself is NOT modified beyond the status field.
  -- seal_payload, sha256_hash, step_breakdown, grand_total_paise all stay.
  -- An auditor can still verify the seal on an expired snapshot.
  -- -------------------------------------------------------
  UPDATE quotation_snapshots
     SET status = 'EXPIRED'
   WHERE snapshot_id = p_snapshot_id;

  RETURN jsonb_build_object(
    'snapshot_id', p_snapshot_id,
    'previous_status', 'SEALED',
    'new_status', 'EXPIRED',
    'project_id', v_snapshot.project_id,
    'sealed_at', v_snapshot.sealed_at,
    'expires_at', v_snapshot.expires_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_quotation_snapshot(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_quotation_snapshot(UUID) TO service_role;
