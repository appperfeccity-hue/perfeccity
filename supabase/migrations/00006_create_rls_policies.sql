-- PERFECCITY MVP — Migration 00006: Row Level Security Policies (REWRITTEN)
-- Source: Engineering Handover v7.0, Part 2 (permission matrix) + Part 7 (API auth)
--
-- FIXES APPLIED IN THIS REWRITE:
-- 1. All auth.uid() calls converted to (SELECT auth.uid()) for plan caching
-- 2. All FOR ALL policies include explicit WITH CHECK clauses
-- 3. Overlapping permissive policies consolidated where safe
-- 4. Per-action (SELECT, INSERT, UPDATE, DELETE) permissions preserved
-- 5. Role-based restrictions verified for ADMIN, SALESPERSON, MANAGER, DESIGNER
-- 6. No unintended privilege expansion during consolidation
--
-- PERFORMANCE NOTES:
-- - (SELECT auth.uid()) is evaluated once per query (subquery scalar cache)
-- - public.user_role() reads from app_metadata only (custom token hook writes there)
-- - Helper functions are STABLE + SECURITY DEFINER (per-statement cacheable)
-- - Role check evaluates first (cheap scalar), short-circuits for Admin

-- ============================================================
-- HELPER FUNCTIONS (STABLE, per-statement cacheable)
-- ============================================================

CREATE OR REPLACE FUNCTION public.user_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.jwt() -> 'app_metadata' ->> 'role';
$$;

CREATE OR REPLACE FUNCTION public.user_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid();
$$;


CREATE OR REPLACE FUNCTION public.consultant_project_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT project_id FROM projects WHERE consultant_id = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.manager_project_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT project_id FROM projects WHERE manager_id = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.staff_project_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT project_id FROM projects
  WHERE consultant_id = (SELECT auth.uid()) OR manager_id = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.designer_draft_template_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT template_id FROM design_templates
  WHERE created_by = (SELECT auth.uid()) AND status = 'DRAFT';
$$;

CREATE OR REPLACE FUNCTION public.consultant_lead_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lead_id FROM leads WHERE assigned_consultant_id = (SELECT auth.uid());
$$;


-- ============================================================
-- GRANTS
-- ============================================================

GRANT EXECUTE ON FUNCTION public.user_role() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.user_id() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.consultant_project_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manager_project_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_project_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.designer_draft_template_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consultant_lead_ids() TO authenticated, service_role;

-- ============================================================
-- DOMAIN 1 — Authentication & Identity
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_admin_all ON users
  FOR ALL
  USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY users_self_read ON users
  FOR SELECT
  USING (user_id = (SELECT auth.uid()));

ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY refresh_tokens_own ON refresh_tokens
  FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY password_reset_tokens_own ON password_reset_tokens
  FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));


-- ============================================================
-- DOMAIN 2 — Lead & Acquisition
-- ============================================================

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY leads_admin_all ON leads
  FOR ALL
  USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY leads_manager_read ON leads
  FOR SELECT
  USING (public.user_role() = 'MANAGER');

CREATE POLICY leads_manager_update ON leads
  FOR UPDATE
  USING (public.user_role() = 'MANAGER')
  WITH CHECK (public.user_role() = 'MANAGER');

CREATE POLICY leads_consultant_read ON leads
  FOR SELECT
  USING (
    public.user_role() = 'SALESPERSON'
    AND assigned_consultant_id = (SELECT auth.uid())
  );

CREATE POLICY leads_consultant_create ON leads
  FOR INSERT
  WITH CHECK (public.user_role() = 'SALESPERSON');

CREATE POLICY leads_consultant_update ON leads
  FOR UPDATE
  USING (
    public.user_role() = 'SALESPERSON'
    AND assigned_consultant_id = (SELECT auth.uid())
  )
  WITH CHECK (
    public.user_role() = 'SALESPERSON'
    AND assigned_consultant_id = (SELECT auth.uid())
  );

ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY lead_activities_admin_read ON lead_activities
  FOR SELECT
  USING (public.user_role() = 'ADMIN');

CREATE POLICY lead_activities_admin_insert ON lead_activities
  FOR INSERT
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY lead_activities_consultant_read ON lead_activities
  FOR SELECT
  USING (
    public.user_role() = 'SALESPERSON'
    AND lead_id IN (SELECT public.consultant_lead_ids())
  );

CREATE POLICY lead_activities_consultant_insert ON lead_activities
  FOR INSERT
  WITH CHECK (
    public.user_role() = 'SALESPERSON'
    AND lead_id IN (SELECT public.consultant_lead_ids())
  );


-- ============================================================
-- DOMAIN 3 — Project & Workflow Core
-- ============================================================

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY projects_admin_all ON projects
  FOR ALL
  USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY projects_manager_read ON projects
  FOR SELECT
  USING (public.user_role() = 'MANAGER');

CREATE POLICY projects_manager_update ON projects
  FOR UPDATE
  USING (
    public.user_role() = 'MANAGER'
    AND manager_id = (SELECT auth.uid())
  )
  WITH CHECK (
    public.user_role() = 'MANAGER'
    AND manager_id = (SELECT auth.uid())
  );

CREATE POLICY projects_consultant_read ON projects
  FOR SELECT
  USING (
    public.user_role() = 'SALESPERSON'
    AND consultant_id = (SELECT auth.uid())
  );

CREATE POLICY projects_consultant_update ON projects
  FOR UPDATE
  USING (
    public.user_role() = 'SALESPERSON'
    AND consultant_id = (SELECT auth.uid())
  )
  WITH CHECK (
    public.user_role() = 'SALESPERSON'
    AND consultant_id = (SELECT auth.uid())
  );

CREATE POLICY projects_consultant_create ON projects
  FOR INSERT
  WITH CHECK (
    public.user_role() = 'SALESPERSON'
    AND consultant_id = (SELECT auth.uid())
  );

ALTER TABLE project_state_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_state_history_admin ON project_state_history
  FOR SELECT
  USING (public.user_role() = 'ADMIN');

CREATE POLICY project_state_history_staff_read ON project_state_history
  FOR SELECT
  USING (
    public.user_role() IN ('MANAGER', 'SALESPERSON')
    AND project_id IN (SELECT public.staff_project_ids())
  );

CREATE POLICY project_state_history_insert ON project_state_history
  FOR INSERT
  WITH CHECK (public.user_role() IN ('ADMIN', 'MANAGER', 'SALESPERSON'));

ALTER TABLE consultation_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY consultation_stages_admin ON consultation_stages
  FOR ALL
  USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY consultation_stages_consultant ON consultation_stages
  FOR ALL
  USING (
    public.user_role() = 'SALESPERSON'
    AND project_id IN (SELECT public.consultant_project_ids())
  )
  WITH CHECK (
    public.user_role() = 'SALESPERSON'
    AND project_id IN (SELECT public.consultant_project_ids())
  );


-- ============================================================
-- DOMAIN 4 — Consultation Discovery
-- Pattern: Admin FOR ALL + Consultant FOR ALL on own projects
-- ============================================================

ALTER TABLE lifestyle_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY lifestyle_assessments_admin ON lifestyle_assessments
  FOR ALL USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY lifestyle_assessments_consultant ON lifestyle_assessments
  FOR ALL
  USING (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()))
  WITH CHECK (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()));

ALTER TABLE budget_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY budget_profiles_admin ON budget_profiles
  FOR ALL USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY budget_profiles_consultant ON budget_profiles
  FOR ALL
  USING (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()))
  WITH CHECK (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()));

ALTER TABLE site_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY site_assessments_admin ON site_assessments
  FOR ALL USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY site_assessments_consultant ON site_assessments
  FOR ALL
  USING (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()))
  WITH CHECK (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()));

ALTER TABLE site_photographs ENABLE ROW LEVEL SECURITY;

CREATE POLICY site_photographs_admin ON site_photographs
  FOR ALL USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY site_photographs_consultant ON site_photographs
  FOR ALL
  USING (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()))
  WITH CHECK (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()));

ALTER TABLE design_dna ENABLE ROW LEVEL SECURITY;

CREATE POLICY design_dna_admin ON design_dna
  FOR ALL USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY design_dna_consultant ON design_dna
  FOR ALL
  USING (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()))
  WITH CHECK (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()));


-- ============================================================
-- DOMAIN 5 — Space & Design Configuration
-- Pattern: Admin FOR ALL + Consultant FOR ALL on own projects
-- ============================================================

ALTER TABLE application_spaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_spaces_admin ON application_spaces
  FOR ALL USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY application_spaces_consultant ON application_spaces
  FOR ALL
  USING (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()))
  WITH CHECK (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()));

ALTER TABLE space_design_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY space_design_overrides_admin ON space_design_overrides
  FOR ALL USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY space_design_overrides_consultant ON space_design_overrides
  FOR ALL
  USING (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()))
  WITH CHECK (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()));

ALTER TABLE space_measurements ENABLE ROW LEVEL SECURITY;

CREATE POLICY space_measurements_admin ON space_measurements
  FOR ALL USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY space_measurements_consultant ON space_measurements
  FOR ALL
  USING (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()))
  WITH CHECK (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()));

ALTER TABLE space_configurations ENABLE ROW LEVEL SECURITY;

CREATE POLICY space_configurations_admin ON space_configurations
  FOR ALL USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY space_configurations_consultant ON space_configurations
  FOR ALL
  USING (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()))
  WITH CHECK (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()));


-- ============================================================
-- DOMAIN 6 — Design Template Library
-- ============================================================

ALTER TABLE design_templates ENABLE ROW LEVEL SECURITY;

-- All staff: read all templates (Design Library, Consultant selection)
CREATE POLICY design_templates_staff_read ON design_templates
  FOR SELECT
  USING (public.user_role() IN ('ADMIN', 'MANAGER', 'SALESPERSON', 'DESIGNER'));

-- Admin: full write (publish/archive/unpublish/any status change)
CREATE POLICY design_templates_admin_write ON design_templates
  FOR ALL
  USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

-- Designer: create own templates (must set created_by to self)
CREATE POLICY design_templates_designer_create ON design_templates
  FOR INSERT
  WITH CHECK (
    public.user_role() = 'DESIGNER'
    AND created_by = (SELECT auth.uid())
  );

-- Designer: update own DRAFT templates only
CREATE POLICY design_templates_designer_update ON design_templates
  FOR UPDATE
  USING (
    public.user_role() = 'DESIGNER'
    AND created_by = (SELECT auth.uid())
    AND status = 'DRAFT'
  )
  WITH CHECK (
    public.user_role() = 'DESIGNER'
    AND created_by = (SELECT auth.uid())
  );

ALTER TABLE design_elements ENABLE ROW LEVEL SECURITY;

CREATE POLICY design_elements_staff_read ON design_elements
  FOR SELECT
  USING (public.user_role() IN ('ADMIN', 'MANAGER', 'SALESPERSON', 'DESIGNER'));

CREATE POLICY design_elements_admin ON design_elements
  FOR ALL
  USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY design_elements_designer_write ON design_elements
  FOR ALL
  USING (public.user_role() = 'DESIGNER' AND template_id IN (SELECT public.designer_draft_template_ids()))
  WITH CHECK (public.user_role() = 'DESIGNER' AND template_id IN (SELECT public.designer_draft_template_ids()));

ALTER TABLE template_consumables ENABLE ROW LEVEL SECURITY;

CREATE POLICY template_consumables_staff_read ON template_consumables
  FOR SELECT
  USING (public.user_role() IN ('ADMIN', 'MANAGER', 'SALESPERSON', 'DESIGNER'));

CREATE POLICY template_consumables_admin ON template_consumables
  FOR ALL
  USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY template_consumables_designer_write ON template_consumables
  FOR ALL
  USING (public.user_role() = 'DESIGNER' AND template_id IN (SELECT public.designer_draft_template_ids()))
  WITH CHECK (public.user_role() = 'DESIGNER' AND template_id IN (SELECT public.designer_draft_template_ids()));

ALTER TABLE digital_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY digital_assets_staff_read ON digital_assets
  FOR SELECT
  USING (public.user_role() IN ('ADMIN', 'MANAGER', 'SALESPERSON', 'DESIGNER'));

CREATE POLICY digital_assets_admin ON digital_assets
  FOR ALL
  USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY digital_assets_designer_write ON digital_assets
  FOR ALL
  USING (public.user_role() = 'DESIGNER' AND template_id IN (SELECT public.designer_draft_template_ids()))
  WITH CHECK (public.user_role() = 'DESIGNER' AND template_id IN (SELECT public.designer_draft_template_ids()));


-- ============================================================
-- DOMAIN 7 — SKU & Pricing Master
-- ============================================================

ALTER TABLE product_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_library_staff_read ON product_library
  FOR SELECT
  USING (public.user_role() IN ('ADMIN', 'MANAGER', 'SALESPERSON', 'DESIGNER'));

CREATE POLICY product_library_admin_write ON product_library
  FOR ALL
  USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY product_library_designer_propose ON product_library
  FOR INSERT
  WITH CHECK (
    public.user_role() = 'DESIGNER'
    AND status = 'PROPOSED'
    AND proposed_by = (SELECT auth.uid())
  );

CREATE POLICY product_library_designer_resubmit ON product_library
  FOR UPDATE
  USING (
    public.user_role() = 'DESIGNER'
    AND proposed_by = (SELECT auth.uid())
    AND status = 'REJECTED'
  )
  WITH CHECK (
    public.user_role() = 'DESIGNER'
    AND proposed_by = (SELECT auth.uid())
  );

ALTER TABLE pricing_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY pricing_settings_admin ON pricing_settings
  FOR ALL
  USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY pricing_settings_consultant_read ON pricing_settings
  FOR SELECT
  USING (public.user_role() = 'SALESPERSON');


-- ============================================================
-- DOMAIN 8 — Quotation & Commercial
-- ============================================================

ALTER TABLE quotation_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY quotation_snapshots_admin ON quotation_snapshots
  FOR ALL USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY quotation_snapshots_consultant ON quotation_snapshots
  FOR ALL
  USING (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()))
  WITH CHECK (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()));

ALTER TABLE bom_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY bom_lines_admin ON bom_lines
  FOR ALL USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

-- Consultant: read-only on BOM (no INSERT/UPDATE/DELETE)
CREATE POLICY bom_lines_consultant ON bom_lines
  FOR SELECT
  USING (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()));

ALTER TABLE configuration_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY configuration_line_items_admin ON configuration_line_items
  FOR ALL USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY configuration_line_items_consultant ON configuration_line_items
  FOR ALL
  USING (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()))
  WITH CHECK (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()));

ALTER TABLE configured_furniture ENABLE ROW LEVEL SECURITY;

CREATE POLICY configured_furniture_admin ON configured_furniture
  FOR ALL USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY configured_furniture_consultant ON configured_furniture
  FOR ALL
  USING (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()))
  WITH CHECK (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()));

ALTER TABLE review_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY review_records_admin ON review_records
  FOR ALL USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY review_records_consultant ON review_records
  FOR ALL
  USING (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()))
  WITH CHECK (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()));

ALTER TABLE advance_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY advance_payments_admin ON advance_payments
  FOR ALL USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY advance_payments_consultant ON advance_payments
  FOR ALL
  USING (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()))
  WITH CHECK (public.user_role() = 'SALESPERSON' AND project_id IN (SELECT public.consultant_project_ids()));


-- ============================================================
-- DOMAIN 9 — Manufacturing & Fulfilment
-- ============================================================

ALTER TABLE manufacturing_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY manufacturing_packages_admin ON manufacturing_packages
  FOR ALL USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY manufacturing_packages_staff_read ON manufacturing_packages
  FOR SELECT
  USING (
    public.user_role() IN ('MANAGER', 'SALESPERSON')
    AND project_id IN (SELECT public.staff_project_ids())
  );

ALTER TABLE installation_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY installation_schedules_admin ON installation_schedules
  FOR ALL USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY installation_schedules_manager ON installation_schedules
  FOR ALL
  USING (public.user_role() = 'MANAGER' AND project_id IN (SELECT public.manager_project_ids()))
  WITH CHECK (public.user_role() = 'MANAGER' AND project_id IN (SELECT public.manager_project_ids()));

CREATE POLICY installation_schedules_consultant_read ON installation_schedules
  FOR SELECT
  USING (
    public.user_role() = 'SALESPERSON'
    AND project_id IN (SELECT public.consultant_project_ids())
  );

ALTER TABLE installation_reschedule_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY installation_reschedule_log_admin ON installation_reschedule_log
  FOR ALL USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY installation_reschedule_log_manager ON installation_reschedule_log
  FOR ALL
  USING (public.user_role() = 'MANAGER' AND project_id IN (SELECT public.manager_project_ids()))
  WITH CHECK (public.user_role() = 'MANAGER' AND project_id IN (SELECT public.manager_project_ids()));

-- ============================================================
-- DOMAIN 10 — Customer Portal Identity
-- ============================================================

ALTER TABLE customer_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_accounts_admin ON customer_accounts
  FOR ALL USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

-- Customer: own record via auth_user_id (service-role handles access until AD-3 column populated)

ALTER TABLE customer_project_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_project_links_admin ON customer_project_links
  FOR ALL USING (public.user_role() = 'ADMIN')
  WITH CHECK (public.user_role() = 'ADMIN');

CREATE POLICY customer_project_links_consultant ON customer_project_links
  FOR SELECT
  USING (
    public.user_role() = 'SALESPERSON'
    AND project_id IN (SELECT public.consultant_project_ids())
  );

-- ============================================================
-- DOMAIN 11 — Platform Services
-- ============================================================

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_admin_read ON audit_log
  FOR SELECT
  USING (public.user_role() = 'ADMIN');

CREATE POLICY audit_log_staff_insert ON audit_log
  FOR INSERT
  WITH CHECK (public.user_role() IN ('ADMIN', 'MANAGER', 'SALESPERSON', 'DESIGNER'));

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users read/update only their own notifications
CREATE POLICY notifications_own_read ON notifications
  FOR SELECT
  USING (recipient_id = (SELECT auth.uid()));

CREATE POLICY notifications_own_update ON notifications
  FOR UPDATE
  USING (recipient_id = (SELECT auth.uid()))
  WITH CHECK (recipient_id = (SELECT auth.uid()));

-- Service role inserts (via Edge Functions using admin client) bypass RLS automatically
-- No INSERT policy needed for authenticated — notifications are system-generated
