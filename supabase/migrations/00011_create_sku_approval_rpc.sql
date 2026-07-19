-- PERFECCITY MVP — Migration 00011: SKU Approval RPC Function
-- Source: Sprint 3 T3; Part 4 (WF-10); AD-20 (self-approval guard)
--
-- Pre-write checklist applied:
-- ✅ SECURITY DEFINER + SET search_path = public (AD-5 pattern)
-- ✅ GRANT EXECUTE TO authenticated, service_role (AD-11)
-- ✅ FOR UPDATE row lock (race: two Admins approving same SKU simultaneously)
-- ✅ Self-approval guard: proposed_by != approver (AD-20)
-- ✅ Atomic: status + pricing + is_active + notification in one transaction
-- ✅ CO-MAINTENANCE markers on all RAISE EXCEPTION sites (AD-18)
--
-- This function performs the ENTIRE approval atomically:
-- 1. Locks the product_library row (FOR UPDATE)
-- 2. Validates status = PROPOSED (else 409)
-- 3. Validates proposed_by != approver (else 422, AD-20)
-- 4. Updates: status→ACTIVE, pricing set, is_active=TRUE
-- 5. Inserts notification for the proposer (SKU approved, now ACTIVE)
--
-- Why notification is in the same transaction: if it were separate and failed,
-- the SKU would be ACTIVE but the Designer who proposed it wouldn't know.
-- Not corrupt state, but incomplete — wrapping in RPC ensures all-or-nothing.

CREATE OR REPLACE FUNCTION approve_sku_proposal(
  p_sku VARCHAR,
  p_approver_id UUID,
  p_unit_cost_paise BIGINT,
  p_sell_price_paise BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _product RECORD;
  _result JSONB;
BEGIN
  -- Validate pricing is provided (Admin must set pricing at approval)
  IF p_unit_cost_paise IS NULL OR p_unit_cost_paise <= 0 THEN
    -- ⚠️ CO-MAINTENANCE: matched by supabase/functions/api-skus/approve.ts (mapRpcError)
    RAISE EXCEPTION 'INVALID_PRICING'
      USING ERRCODE = 'P0010',
            HINT = 'unit_cost_paise must be a positive integer (paise)';
  END IF;

  IF p_sell_price_paise IS NULL OR p_sell_price_paise <= 0 THEN
    -- ⚠️ CO-MAINTENANCE: matched by api-skus/approve.ts
    RAISE EXCEPTION 'INVALID_PRICING'
      USING ERRCODE = 'P0010',
            HINT = 'sell_price_paise must be a positive integer (paise)';
  END IF;

  -- Lock the row to prevent concurrent approval race
  SELECT * INTO _product
  FROM product_library
  WHERE sku = p_sku
  FOR UPDATE;

  IF NOT FOUND THEN
    -- ⚠️ CO-MAINTENANCE: matched by api-skus/approve.ts
    RAISE EXCEPTION 'SKU_NOT_FOUND'
      USING ERRCODE = 'P0011',
            HINT = 'No SKU exists with code: ' || p_sku;
  END IF;

  -- Status must be PROPOSED
  IF _product.status != 'PROPOSED' THEN
    -- ⚠️ CO-MAINTENANCE: matched by api-skus/approve.ts
    RAISE EXCEPTION 'SKU_NOT_PROPOSED'
      USING ERRCODE = 'P0012',
            HINT = 'SKU status is ' || _product.status || ', not PROPOSED. Only PROPOSED SKUs can be approved.';
  END IF;

  -- AD-20: Self-approval guard
  -- Structurally impossible in production (DESIGNER ≠ ADMIN, single role per user),
  -- but enforced at DB level for defense-in-depth (test accounts, future multi-role).
  -- This does NOT address rubber-stamping — only same-account-both-roles.
  IF _product.proposed_by = p_approver_id THEN
    -- ⚠️ CO-MAINTENANCE: matched by api-skus/approve.ts
    RAISE EXCEPTION 'SELF_APPROVAL_NOT_ALLOWED'
      USING ERRCODE = 'P0013',
            HINT = 'The user who proposed a SKU cannot also approve it (AD-20)';
  END IF;

  -- Atomic approval: status + pricing + is_active
  UPDATE product_library SET
    status = 'ACTIVE',
    is_active = TRUE,
    unit_cost_paise = p_unit_cost_paise,
    sell_price_paise = p_sell_price_paise,
    updated_at = now()
  WHERE sku = p_sku;

  -- Notification to the proposer: their SKU is now ACTIVE
  -- (Not using SKU_REJECTED here — that's for reject. No specific enum value for
  -- "approved" in notification_type_enum. Using APPROVAL_CONFIRMATION as closest fit,
  -- though it's documented for quotation approval. This is a known enum gap — see
  -- Part 15 item 9 about confirming all 9 enum values for MVP.)
  -- For now: insert a generic notification. The type enum may need a 10th value
  -- (SKU_APPROVED) in a future migration if the 9-value set is confirmed as final.
  -- Using APPROVAL_CONFIRMATION as the closest available value.
  INSERT INTO notifications (recipient_id, type, message)
  VALUES (
    _product.proposed_by,
    'APPROVAL_CONFIRMATION',
    'Your SKU proposal "' || _product.name || '" (' || p_sku || ') has been approved and is now active.'
  );

  -- Return the updated product
  SELECT to_jsonb(p.*) INTO _result
  FROM product_library p WHERE p.sku = p_sku;

  RETURN _result;
END;
$$;

-- Grants (AD-11): required for RLS policies and Edge Function calls
GRANT EXECUTE ON FUNCTION approve_sku_proposal(VARCHAR, UUID, BIGINT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_sku_proposal(VARCHAR, UUID, BIGINT, BIGINT) TO service_role;
