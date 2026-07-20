-- Migration 00014: Review Gate RPC (Sprint 5 T1)
-- Atomic function: evaluates 7-item WF-4 checklist, inserts review_records,
-- and transitions project.status = REVIEWED on pass.
-- Per pre-write checklist: SECURITY DEFINER + SET search_path + GRANT.

-- ============================================================
-- RPC: submit_review_gate
-- Called by owning Consultant via POST /api/v1/projects/:id/review
-- ============================================================

CREATE OR REPLACE FUNCTION public.submit_review_gate(
  p_project_id UUID,
  p_reviewer_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project RECORD;
  v_checklist JSONB;
  v_failures TEXT[] := '{}';
  v_result review_result_enum;
  v_review_id UUID;
  v_check_customer_info BOOLEAN;
  v_check_design_selected BOOLEAN;
  v_check_samples_verified BOOLEAN;
  v_check_site_photo BOOLEAN;
  v_check_current_config BOOLEAN;
  v_check_skus_active BOOLEAN;
  v_check_budget BOOLEAN;
  v_space_count INTEGER;
  v_spaces_with_template INTEGER;
  v_spaces_verified INTEGER;
  v_spaces_with_current_config INTEGER;
  v_inactive_skus INTEGER;
  v_photo_count INTEGER;
  v_budget_tier TEXT;
BEGIN
  -- -------------------------------------------------------
  -- Guard: project must exist and be in CONFIGURING status
  -- -------------------------------------------------------
  SELECT p.project_id, p.status, p.lead_id, p.customer_name
    INTO v_project
    FROM projects p
   WHERE p.project_id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROJECT_NOT_FOUND: %', p_project_id;
  END IF;

  IF v_project.status != 'CONFIGURING' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Project must be in CONFIGURING status (current: %)', v_project.status;
    -- ⚠️ CO-MAINTENANCE: matched by supabase/functions/api-review/index.ts
  END IF;

  -- -------------------------------------------------------
  -- CHECK 1: Customer info complete (name, mobile, email non-null)
  -- customer_name is NOT NULL on projects, so always passes for name.
  -- mobile and email are on the leads table (via lead_id).
  -- -------------------------------------------------------
  IF v_project.lead_id IS NULL THEN
    -- No linked lead — can't verify mobile/email
    v_check_customer_info := FALSE;
  ELSE
    SELECT
      (l.mobile_encrypted IS NOT NULL AND l.email_address IS NOT NULL)
      INTO v_check_customer_info
    FROM leads l
    WHERE l.lead_id = v_project.lead_id;

    IF NOT FOUND THEN
      v_check_customer_info := FALSE;
    END IF;
  END IF;

  IF NOT v_check_customer_info THEN
    v_failures := array_append(v_failures, 'Customer info incomplete (name, mobile, or email missing)');
  END IF;

  -- -------------------------------------------------------
  -- CHECK 2: Design selected all spaces (every space has selected_template_id)
  -- -------------------------------------------------------
  SELECT COUNT(*) INTO v_space_count
    FROM application_spaces
   WHERE project_id = p_project_id;

  IF v_space_count = 0 THEN
    v_check_design_selected := FALSE;
  ELSE
    SELECT COUNT(*) INTO v_spaces_with_template
      FROM application_spaces
     WHERE project_id = p_project_id
       AND selected_template_id IS NOT NULL;

    v_check_design_selected := (v_spaces_with_template = v_space_count);
  END IF;

  IF NOT v_check_design_selected THEN
    v_failures := array_append(v_failures,
      format('Design not selected for all spaces (%s/%s)', v_spaces_with_template, v_space_count));
  END IF;

  -- -------------------------------------------------------
  -- CHECK 3: Samples verified all spaces (sample_verified = TRUE)
  -- -------------------------------------------------------
  SELECT COUNT(*) INTO v_spaces_verified
    FROM application_spaces
   WHERE project_id = p_project_id
     AND sample_verified = TRUE;

  v_check_samples_verified := (v_space_count > 0 AND v_spaces_verified = v_space_count);

  IF NOT v_check_samples_verified THEN
    v_failures := array_append(v_failures,
      format('Samples not verified for all spaces (%s/%s)', v_spaces_verified, v_space_count));
  END IF;

  -- -------------------------------------------------------
  -- CHECK 4: ≥1 site photo exists (site_photographs where is_deleted = FALSE)
  -- -------------------------------------------------------
  SELECT COUNT(*) INTO v_photo_count
    FROM site_photographs
   WHERE project_id = p_project_id
     AND is_deleted = FALSE;

  v_check_site_photo := (v_photo_count >= 1);

  IF NOT v_check_site_photo THEN
    v_failures := array_append(v_failures, 'No site photographs uploaded');
  END IF;

  -- -------------------------------------------------------
  -- CHECK 5: Current config all spaces (every space has is_current = TRUE config)
  -- -------------------------------------------------------
  SELECT COUNT(DISTINCT sc.space_id) INTO v_spaces_with_current_config
    FROM space_configurations sc
   WHERE sc.project_id = p_project_id
     AND sc.is_current = TRUE;

  v_check_current_config := (v_space_count > 0 AND v_spaces_with_current_config = v_space_count);

  IF NOT v_check_current_config THEN
    v_failures := array_append(v_failures,
      format('Not all spaces have a current configuration (%s/%s)', v_spaces_with_current_config, v_space_count));
  END IF;

  -- -------------------------------------------------------
  -- CHECK 6: All referenced SKUs ACTIVE (every SKU in current configs is active)
  -- -------------------------------------------------------
  SELECT COUNT(*) INTO v_inactive_skus
    FROM configuration_line_items cli
    JOIN space_configurations sc ON sc.config_id = cli.config_id
    JOIN product_library pl ON pl.sku = cli.sku
   WHERE sc.project_id = p_project_id
     AND sc.is_current = TRUE
     AND pl.status != 'ACTIVE';

  v_check_skus_active := (v_inactive_skus = 0);

  IF NOT v_check_skus_active THEN
    v_failures := array_append(v_failures,
      format('%s SKU(s) in current configurations are not ACTIVE', v_inactive_skus));
  END IF;

  -- -------------------------------------------------------
  -- CHECK 7: Budget confirmed (budget_profiles.budget_tier non-null)
  -- -------------------------------------------------------
  SELECT bp.budget_tier::TEXT INTO v_budget_tier
    FROM budget_profiles bp
   WHERE bp.project_id = p_project_id;

  v_check_budget := (v_budget_tier IS NOT NULL);

  IF NOT v_check_budget THEN
    v_failures := array_append(v_failures, 'Budget tier not confirmed');
  END IF;

  -- -------------------------------------------------------
  -- Build checklist JSON + determine result
  -- -------------------------------------------------------
  v_checklist := jsonb_build_object(
    'customer_info_complete', v_check_customer_info,
    'design_selected_all_spaces', v_check_design_selected,
    'samples_verified_all_spaces', v_check_samples_verified,
    'site_photo_exists', v_check_site_photo,
    'current_config_all_spaces', v_check_current_config,
    'all_skus_active', v_check_skus_active,
    'budget_confirmed', v_check_budget
  );

  IF array_length(v_failures, 1) IS NULL OR array_length(v_failures, 1) = 0 THEN
    v_result := 'PASS';
  ELSE
    v_result := 'FAIL';
  END IF;

  -- -------------------------------------------------------
  -- Insert review_records row (always, pass or fail)
  -- -------------------------------------------------------
  INSERT INTO review_records (project_id, reviewed_by, result, checklist_json, failure_reasons)
  VALUES (p_project_id, p_reviewer_id, v_result, v_checklist, v_failures)
  RETURNING review_id INTO v_review_id;

  -- -------------------------------------------------------
  -- On PASS: transition status + set latest_review_id
  -- On FAIL: set latest_review_id only (status stays CONFIGURING)
  -- -------------------------------------------------------
  IF v_result = 'PASS' THEN
    UPDATE projects
       SET status = 'REVIEWED',
           latest_review_id = v_review_id,
           updated_at = now()
     WHERE project_id = p_project_id;

    -- Record state transition
    INSERT INTO project_state_history (project_id, from_status, to_status, actor_id, trigger_rule)
    VALUES (p_project_id, 'CONFIGURING', 'REVIEWED', p_reviewer_id, 'review_gate_pass');
  ELSE
    UPDATE projects
       SET latest_review_id = v_review_id,
           updated_at = now()
     WHERE project_id = p_project_id;
  END IF;

  -- -------------------------------------------------------
  -- Return result
  -- -------------------------------------------------------
  RETURN jsonb_build_object(
    'review_id', v_review_id,
    'result', v_result,
    'checklist', v_checklist,
    'failure_reasons', to_jsonb(v_failures)
  );
END;
$$;

-- Grants (per pre-write checklist)
GRANT EXECUTE ON FUNCTION public.submit_review_gate(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_review_gate(UUID, UUID) TO service_role;
