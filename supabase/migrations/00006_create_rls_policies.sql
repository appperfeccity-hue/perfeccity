-- PERFECCITY MVP — Migration 00006: Row Level Security Policies
-- Source of truth: Engineering Handover v7.0, Part 2 (permission matrix) + Part 7 (API auth)
--
-- PERFORMANCE NOTES:
-- 1. auth.user_role() reads from app_metadata ONLY (that's where the custom token hook writes)
-- 2. Subquery-based policies use helper functions that Postgres can inline/cache per-statement
-- 3. All FK columns referenced in policy subqueries have indexes (see 00005_create_indexes.sql)
-- 4. Role check is evaluated first (cheap scalar) before any subquery (short-circuits for Admin)
--
-- Convention: role is stored in auth.jwt() -> 'app_metadata' -> 'role'
-- (NOT user_metadata — the custom_access_token_hook writes to app_metadata exclusively)

-- ============================================================
-- HELPER FUNCTIONS (STABLE, per-statement cacheable)
-- ============================================================

-- Extract current user's role from JWT app_metadata (NOT user_metadata)
CREATE OR REPLACE FUNCTION auth.user_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = auth
AS $$
  SELECT auth.jwt() -> 'app_metadata' ->> 'role';
$$;

-- Get current user's UUID (alias for auth.uid(), but STABLE-marked for optimizer)
CREATE OR REPLACE FUNCTION auth.user_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = auth
AS $$
  SELECT auth.uid();
$$;

-- Returns project_ids owned by the current Consultant.
-- STABLE + SECURITY DEFINER: Postgres can cache the result within a single statement,
-- so joined queries across multiple tables each checking project ownership don't
-- re-execute the subquery per row per table.
CREATE OR REPLACE FUNCTION auth.consultant_project_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT project_id FROM projects WHERE consultant_id = auth.uid();
$$;

-- Returns project_ids managed by the current Manager.
CREATE OR REPLACE FUNCTION auth.manager_project_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT project_id FROM projects WHERE manager_id = auth.uid();
$$;

-- Returns project_ids accessible to the current user (either as consultant or manager).
CREATE OR REPLACE FUNCTION auth.staff_project_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT project_id FROM projects
  WHERE consultant_id = auth.uid() OR manager_id = auth.uid();
$$;

-- Returns template_ids owned by the current Designer in DRAFT status.
CREATE OR REPLACE FUNCTION auth.designer_draft_template_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT template_id FROM design_templates
  WHERE created_by = auth.uid() AND status = 'DRAFT';
$$;

-- Returns lead_ids assigned to the current Consultant.
CREATE OR REPLACE FUNCTION auth.consultant_lead_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lead_id FROM leads WHERE assigned_consultant_id = auth.uid();
$$;

-- ============================================================
-- GRANTS — Helper functions must be executable by authenticated users
-- Without these, RLS policies calling the helpers fail CLOSED (permission denied),
-- not fail SAFE (no rows). This is a security-critical step, not optional.
-- ============================================================

GRANT EXECUTE ON FUNCTION auth.user_role() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.user_id() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.consultant_project_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.manager_project_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.staff_project_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.designer_draft_template_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.consultant_lead_ids() TO authenticated, service_role;

-- ============================================================
-- DOMAIN 1 — Authentication & Identity
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_admin_all ON users
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY users_self_read ON users
  FOR SELECT USING (user_id = auth.uid());

ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY refresh_tokens_own ON refresh_tokens
  FOR ALL USING (user_id = auth.uid());

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY password_reset_tokens_own ON password_reset_tokens
  FOR ALL USING (user_id = auth.uid());

-- ============================================================
-- DOMAIN 2 — Lead & Acquisition
-- ============================================================

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY leads_admin_all ON leads
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Manager: read all leads (for assignment queue)
CREATE POLICY leads_manager_read ON leads
  FOR SELECT USING (auth.user_role() = 'MANAGER');

-- Manager: update leads (for assignment via SECURITY DEFINER RPC — but direct
-- UPDATE also needed for edge cases; RPC is the primary path)
CREATE POLICY leads_manager_update ON leads
  FOR UPDATE USING (auth.user_role() = 'MANAGER');

-- Consultant: read own assigned leads only (direct FK check, no subquery needed)
CREATE POLICY leads_consultant_read ON leads
  FOR SELECT USING (
    auth.user_role() = 'SALESPERSON'
    AND assigned_consultant_id = auth.uid()
  );

-- Consultant: create leads (WF-1)
CREATE POLICY leads_consultant_create ON leads
  FOR INSERT WITH CHECK (auth.user_role() = 'SALESPERSON');

-- Consultant: update own assigned leads
CREATE POLICY leads_consultant_update ON leads
  FOR UPDATE USING (
    auth.user_role() = 'SALESPERSON'
    AND assigned_consultant_id = auth.uid()
  );

ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY lead_activities_admin_all ON lead_activities
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Consultant: own leads' activities (uses cached helper)
CREATE POLICY lead_activities_consultant ON lead_activities
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND lead_id IN (SELECT auth.consultant_lead_ids())
  );

-- ============================================================
-- DOMAIN 3 — Project & Workflow Core
-- ============================================================

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY projects_admin_all ON projects
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Manager: read all projects (installation queue needs full visibility)
CREATE POLICY projects_manager_read ON projects
  FOR SELECT USING (auth.user_role() = 'MANAGER');

-- Manager: update own managed projects only
CREATE POLICY projects_manager_update ON projects
  FOR UPDATE USING (
    auth.user_role() = 'MANAGER'
    AND manager_id = auth.uid()
  );

-- Consultant: direct FK check (no subquery — projects.consultant_id is the source)
CREATE POLICY projects_consultant_read ON projects
  FOR SELECT USING (
    auth.user_role() = 'SALESPERSON'
    AND consultant_id = auth.uid()
  );

CREATE POLICY projects_consultant_update ON projects
  FOR UPDATE USING (
    auth.user_role() = 'SALESPERSON'
    AND consultant_id = auth.uid()
  );

CREATE POLICY projects_consultant_create ON projects
  FOR INSERT WITH CHECK (
    auth.user_role() = 'SALESPERSON'
    AND consultant_id = auth.uid()
  );

ALTER TABLE project_state_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_state_history_admin ON project_state_history
  FOR SELECT USING (auth.user_role() = 'ADMIN');

-- Staff: read history of accessible projects (uses cached helper)
CREATE POLICY project_state_history_staff_read ON project_state_history
  FOR SELECT USING (
    auth.user_role() IN ('MANAGER', 'SALESPERSON')
    AND project_id IN (SELECT auth.staff_project_ids())
  );

-- Insert: any staff (system-generated entries via RPC/Edge Functions)
CREATE POLICY project_state_history_insert ON project_state_history
  FOR INSERT WITH CHECK (auth.user_role() IN ('ADMIN', 'MANAGER', 'SALESPERSON'));

ALTER TABLE consultation_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY consultation_stages_admin ON consultation_stages
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Consultant: own projects only (uses cached helper)
CREATE POLICY consultation_stages_consultant ON consultation_stages
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (SELECT auth.consultant_project_ids())
  );

-- ============================================================
-- DOMAIN 4 — Consultation Discovery
-- (All 5 tables use the same pattern: Admin full + Consultant own projects)
-- ============================================================

ALTER TABLE lifestyle_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY lifestyle_assessments_admin ON lifestyle_assessments
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY lifestyle_assessments_consultant ON lifestyle_assessments
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (SELECT auth.consultant_project_ids())
  );

ALTER TABLE budget_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY budget_profiles_admin ON budget_profiles
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY budget_profiles_consultant ON budget_profiles
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (SELECT auth.consultant_project_ids())
  );

ALTER TABLE site_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY site_assessments_admin ON site_assessments
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY site_assessments_consultant ON site_assessments
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (SELECT auth.consultant_project_ids())
  );

ALTER TABLE site_photographs ENABLE ROW LEVEL SECURITY;

CREATE POLICY site_photographs_admin ON site_photographs
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY site_photographs_consultant ON site_photographs
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (SELECT auth.consultant_project_ids())
  );

ALTER TABLE design_dna ENABLE ROW LEVEL SECURITY;

CREATE POLICY design_dna_admin ON design_dna
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY design_dna_consultant ON design_dna
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (SELECT auth.consultant_project_ids())
  );

-- ============================================================
-- DOMAIN 5 — Space & Design Configuration
-- (Same pattern: Admin full + Consultant own projects via helper)
-- ============================================================

ALTER TABLE application_spaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_spaces_admin ON application_spaces
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY application_spaces_consultant ON application_spaces
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (SELECT auth.consultant_project_ids())
  );

ALTER TABLE space_design_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY space_design_overrides_admin ON space_design_overrides
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY space_design_overrides_consultant ON space_design_overrides
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (SELECT auth.consultant_project_ids())
  );

ALTER TABLE space_measurements ENABLE ROW LEVEL SECURITY;

CREATE POLICY space_measurements_admin ON space_measurements
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY space_measurements_consultant ON space_measurements
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (SELECT auth.consultant_project_ids())
  );

ALTER TABLE space_configurations ENABLE ROW LEVEL SECURITY;

CREATE POLICY space_configurations_admin ON space_configurations
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY space_configurations_consultant ON space_configurations
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (SELECT auth.consultant_project_ids())
  );

-- ============================================================
-- DOMAIN 6 — Design Template Library
-- ============================================================

ALTER TABLE design_templates ENABLE ROW LEVEL SECURITY;

-- All staff can read templates (Design Library, Consultant selection)
CREATE POLICY design_templates_staff_read ON design_templates
  FOR SELECT USING (auth.user_role() IN ('ADMIN', 'MANAGER', 'SALESPERSON', 'DESIGNER'));

-- Admin: full write access (publish/archive/unpublish)
CREATE POLICY design_templates_admin_write ON design_templates
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Designer: create own templates
CREATE POLICY design_templates_designer_create ON design_templates
  FOR INSERT WITH CHECK (
    auth.user_role() = 'DESIGNER'
    AND created_by = auth.uid()
  );

-- Designer: update own DRAFT templates only (direct column check, no subquery)
CREATE POLICY design_templates_designer_update ON design_templates
  FOR UPDATE USING (
    auth.user_role() = 'DESIGNER'
    AND created_by = auth.uid()
    AND status = 'DRAFT'
  );

ALTER TABLE design_elements ENABLE ROW LEVEL SECURITY;

CREATE POLICY design_elements_staff_read ON design_elements
  FOR SELECT USING (auth.user_role() IN ('ADMIN', 'MANAGER', 'SALESPERSON', 'DESIGNER'));

-- Designer: write on own DRAFT templates (uses cached helper)
CREATE POLICY design_elements_designer_write ON design_elements
  FOR ALL USING (
    auth.user_role() = 'DESIGNER'
    AND template_id IN (SELECT auth.designer_draft_template_ids())
  );

CREATE POLICY design_elements_admin ON design_elements
  FOR ALL USING (auth.user_role() = 'ADMIN');

ALTER TABLE template_consumables ENABLE ROW LEVEL SECURITY;

CREATE POLICY template_consumables_staff_read ON template_consumables
  FOR SELECT USING (auth.user_role() IN ('ADMIN', 'MANAGER', 'SALESPERSON', 'DESIGNER'));

CREATE POLICY template_consumables_designer_write ON template_consumables
  FOR ALL USING (
    auth.user_role() = 'DESIGNER'
    AND template_id IN (SELECT auth.designer_draft_template_ids())
  );

CREATE POLICY template_consumables_admin ON template_consumables
  FOR ALL USING (auth.user_role() = 'ADMIN');

ALTER TABLE digital_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY digital_assets_staff_read ON digital_assets
  FOR SELECT USING (auth.user_role() IN ('ADMIN', 'MANAGER', 'SALESPERSON', 'DESIGNER'));

CREATE POLICY digital_assets_designer_write ON digital_assets
  FOR ALL USING (
    auth.user_role() = 'DESIGNER'
    AND template_id IN (SELECT auth.designer_draft_template_ids())
  );

CREATE POLICY digital_assets_admin ON digital_assets
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- ============================================================
-- DOMAIN 7 — SKU & Pricing Master
-- ============================================================

ALTER TABLE product_library ENABLE ROW LEVEL SECURITY;

-- All staff can read (SKU picker, BOM view, template building)
CREATE POLICY product_library_staff_read ON product_library
  FOR SELECT USING (auth.user_role() IN ('ADMIN', 'MANAGER', 'SALESPERSON', 'DESIGNER'));

-- Admin: full CRUD
CREATE POLICY product_library_admin_write ON product_library
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Designer: insert proposals only (no subquery needed — direct column check)
CREATE POLICY product_library_designer_propose ON product_library
  FOR INSERT WITH CHECK (
    auth.user_role() = 'DESIGNER'
    AND status = 'PROPOSED'
    AND proposed_by = auth.uid()
  );

-- Designer: update own REJECTED proposals (resubmit)
CREATE POLICY product_library_designer_resubmit ON product_library
  FOR UPDATE USING (
    auth.user_role() = 'DESIGNER'
    AND proposed_by = auth.uid()
    AND status = 'REJECTED'
  );

ALTER TABLE pricing_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY pricing_settings_admin ON pricing_settings
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY pricing_settings_consultant_read ON pricing_settings
  FOR SELECT USING (auth.user_role() = 'SALESPERSON');

-- ============================================================
-- DOMAIN 8 — Quotation & Commercial
-- (All tables use cached project_id helper for Consultant)
-- ============================================================

ALTER TABLE quotation_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY quotation_snapshots_admin ON quotation_snapshots
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY quotation_snapshots_consultant ON quotation_snapshots
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (SELECT auth.consultant_project_ids())
  );

ALTER TABLE bom_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY bom_lines_admin ON bom_lines
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY bom_lines_consultant ON bom_lines
  FOR SELECT USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (SELECT auth.consultant_project_ids())
  );

ALTER TABLE configuration_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY configuration_line_items_admin ON configuration_line_items
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY configuration_line_items_consultant ON configuration_line_items
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (SELECT auth.consultant_project_ids())
  );

ALTER TABLE configured_furniture ENABLE ROW LEVEL SECURITY;

CREATE POLICY configured_furniture_admin ON configured_furniture
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY configured_furniture_consultant ON configured_furniture
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (SELECT auth.consultant_project_ids())
  );

ALTER TABLE review_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY review_records_admin ON review_records
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY review_records_consultant ON review_records
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (SELECT auth.consultant_project_ids())
  );

ALTER TABLE advance_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY advance_payments_admin ON advance_payments
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY advance_payments_consultant ON advance_payments
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (SELECT auth.consultant_project_ids())
  );

-- ============================================================
-- DOMAIN 9 — Manufacturing & Fulfilment
-- ============================================================

ALTER TABLE manufacturing_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY manufacturing_packages_admin ON manufacturing_packages
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Staff: read only on relevant projects (uses cached helper)
CREATE POLICY manufacturing_packages_staff_read ON manufacturing_packages
  FOR SELECT USING (
    auth.user_role() IN ('MANAGER', 'SALESPERSON')
    AND project_id IN (SELECT auth.staff_project_ids())
  );

ALTER TABLE installation_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY installation_schedules_admin ON installation_schedules
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Manager: full access on own managed (direct FK check on manager_id)
CREATE POLICY installation_schedules_manager ON installation_schedules
  FOR ALL USING (
    auth.user_role() = 'MANAGER'
    AND manager_id = auth.uid()
  );

-- Consultant: read only on own projects
CREATE POLICY installation_schedules_consultant_read ON installation_schedules
  FOR SELECT USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (SELECT auth.consultant_project_ids())
  );

ALTER TABLE installation_reschedule_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY installation_reschedule_log_admin ON installation_reschedule_log
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Manager: own managed projects (uses cached helper)
CREATE POLICY installation_reschedule_log_manager ON installation_reschedule_log
  FOR ALL USING (
    auth.user_role() = 'MANAGER'
    AND project_id IN (SELECT auth.manager_project_ids())
  );

-- ============================================================
-- DOMAIN 10 — Customer Portal Identity
-- ============================================================

ALTER TABLE customer_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_accounts_admin ON customer_accounts
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Customer: own record only (uses auth.uid() which maps to auth_user_id after AD-3 column is added)
-- NOTE: This policy will be updated in migration 00007b when auth_user_id column exists.
-- For now, customers access their data via service-role Edge Functions with app-layer ownership checks.

ALTER TABLE customer_project_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_project_links_admin ON customer_project_links
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Consultant: read links for own projects
CREATE POLICY customer_project_links_consultant ON customer_project_links
  FOR SELECT USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (SELECT auth.consultant_project_ids())
  );

-- ============================================================
-- DOMAIN 11 — Platform Services
-- ============================================================

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_admin_read ON audit_log
  FOR SELECT USING (auth.user_role() = 'ADMIN');

-- All staff: insert (system-generated audit entries)
CREATE POLICY audit_log_staff_insert ON audit_log
  FOR INSERT WITH CHECK (
    auth.user_role() IN ('ADMIN', 'MANAGER', 'SALESPERSON', 'DESIGNER')
  );

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can read/update their own notifications only (direct FK check)
CREATE POLICY notifications_own ON notifications
  FOR ALL USING (recipient_id = auth.uid());

-- System (service role) can insert notifications for anyone
-- (handled by service_role bypass, no explicit policy needed for inserts
-- from Edge Functions using the service_role key)
