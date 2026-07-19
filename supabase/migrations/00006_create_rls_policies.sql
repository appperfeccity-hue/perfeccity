-- PERFECCITY MVP — Migration 00006: Row Level Security Policies
-- Source of truth: Engineering Handover v7.0, Part 2 (permission matrix) + Part 7 (API auth)
--
-- Convention: role is stored in auth.jwt() -> 'user_metadata' -> 'role'
-- Staff users authenticate via Supabase Auth; role claim drives all access.
-- Customer accounts use a separate auth flow (customer_accounts table).
--
-- Helper function to extract the current user's role from JWT claims:

CREATE OR REPLACE FUNCTION auth.user_role()
RETURNS TEXT AS $$
  SELECT coalesce(
    auth.jwt() -> 'user_metadata' ->> 'role',
    auth.jwt() -> 'app_metadata' ->> 'role'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper function to get current user's ID
CREATE OR REPLACE FUNCTION auth.user_id()
RETURNS UUID AS $$
  SELECT auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- DOMAIN 1 — Authentication & Identity
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Admin: full access to all users
CREATE POLICY users_admin_all ON users
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Non-admin staff: read own record only
CREATE POLICY users_self_read ON users
  FOR SELECT USING (user_id = auth.user_id());

ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;

-- Users can only see/manage their own refresh tokens
CREATE POLICY refresh_tokens_own ON refresh_tokens
  FOR ALL USING (user_id = auth.user_id());

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- Users can only see their own reset tokens
CREATE POLICY password_reset_tokens_own ON password_reset_tokens
  FOR ALL USING (user_id = auth.user_id());

-- ============================================================
-- DOMAIN 2 — Lead & Acquisition
-- ============================================================

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Admin: full access
CREATE POLICY leads_admin_all ON leads
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Manager: read all leads (for assignment queue + read-only log)
CREATE POLICY leads_manager_read ON leads
  FOR SELECT USING (auth.user_role() = 'MANAGER');

-- Manager: update leads for assignment (assign action only)
CREATE POLICY leads_manager_assign ON leads
  FOR UPDATE USING (auth.user_role() = 'MANAGER');

-- Consultant: read own assigned leads only
CREATE POLICY leads_consultant_read ON leads
  FOR SELECT USING (
    auth.user_role() = 'SALESPERSON'
    AND assigned_consultant_id = auth.user_id()
  );

-- Consultant: create leads (WF-1)
CREATE POLICY leads_consultant_create ON leads
  FOR INSERT WITH CHECK (auth.user_role() = 'SALESPERSON');

-- Consultant: update own assigned leads
CREATE POLICY leads_consultant_update ON leads
  FOR UPDATE USING (
    auth.user_role() = 'SALESPERSON'
    AND assigned_consultant_id = auth.user_id()
  );

ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;

-- Admin: full access
CREATE POLICY lead_activities_admin_all ON lead_activities
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Consultant: read/create on own leads' activities
CREATE POLICY lead_activities_consultant ON lead_activities
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND lead_id IN (
      SELECT lead_id FROM leads WHERE assigned_consultant_id = auth.user_id()
    )
  );

-- ============================================================
-- DOMAIN 3 — Project & Workflow Core
-- ============================================================

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Admin: full access
CREATE POLICY projects_admin_all ON projects
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Manager: read all projects (for installation queue), update own managed projects
CREATE POLICY projects_manager_read ON projects
  FOR SELECT USING (auth.user_role() = 'MANAGER');

CREATE POLICY projects_manager_update ON projects
  FOR UPDATE USING (
    auth.user_role() = 'MANAGER'
    AND manager_id = auth.user_id()
  );

-- Consultant: read/update own projects only
CREATE POLICY projects_consultant_read ON projects
  FOR SELECT USING (
    auth.user_role() = 'SALESPERSON'
    AND consultant_id = auth.user_id()
  );

CREATE POLICY projects_consultant_update ON projects
  FOR UPDATE USING (
    auth.user_role() = 'SALESPERSON'
    AND consultant_id = auth.user_id()
  );

CREATE POLICY projects_consultant_create ON projects
  FOR INSERT WITH CHECK (
    auth.user_role() = 'SALESPERSON'
    AND consultant_id = auth.user_id()
  );

ALTER TABLE project_state_history ENABLE ROW LEVEL SECURITY;

-- Admin: full read
CREATE POLICY project_state_history_admin ON project_state_history
  FOR SELECT USING (auth.user_role() = 'ADMIN');

-- Staff: read history of accessible projects
CREATE POLICY project_state_history_staff_read ON project_state_history
  FOR SELECT USING (
    auth.user_role() IN ('MANAGER', 'SALESPERSON')
    AND project_id IN (
      SELECT project_id FROM projects
      WHERE consultant_id = auth.user_id() OR manager_id = auth.user_id()
    )
  );

-- Insert: any staff involved in the project (system-generated)
CREATE POLICY project_state_history_insert ON project_state_history
  FOR INSERT WITH CHECK (auth.user_role() IN ('ADMIN', 'MANAGER', 'SALESPERSON'));

ALTER TABLE consultation_stages ENABLE ROW LEVEL SECURITY;

-- Admin: full access
CREATE POLICY consultation_stages_admin ON consultation_stages
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Consultant: own projects only
CREATE POLICY consultation_stages_consultant ON consultation_stages
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (
      SELECT project_id FROM projects WHERE consultant_id = auth.user_id()
    )
  );

-- ============================================================
-- DOMAIN 4 — Consultation Discovery
-- ============================================================

ALTER TABLE lifestyle_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY lifestyle_assessments_admin ON lifestyle_assessments
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY lifestyle_assessments_consultant ON lifestyle_assessments
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (
      SELECT project_id FROM projects WHERE consultant_id = auth.user_id()
    )
  );

ALTER TABLE budget_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY budget_profiles_admin ON budget_profiles
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY budget_profiles_consultant ON budget_profiles
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (
      SELECT project_id FROM projects WHERE consultant_id = auth.user_id()
    )
  );

ALTER TABLE site_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY site_assessments_admin ON site_assessments
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY site_assessments_consultant ON site_assessments
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (
      SELECT project_id FROM projects WHERE consultant_id = auth.user_id()
    )
  );

ALTER TABLE site_photographs ENABLE ROW LEVEL SECURITY;

CREATE POLICY site_photographs_admin ON site_photographs
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY site_photographs_consultant ON site_photographs
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (
      SELECT project_id FROM projects WHERE consultant_id = auth.user_id()
    )
  );

ALTER TABLE design_dna ENABLE ROW LEVEL SECURITY;

CREATE POLICY design_dna_admin ON design_dna
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY design_dna_consultant ON design_dna
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (
      SELECT project_id FROM projects WHERE consultant_id = auth.user_id()
    )
  );

-- ============================================================
-- DOMAIN 5 — Space & Design Configuration
-- ============================================================

ALTER TABLE application_spaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_spaces_admin ON application_spaces
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY application_spaces_consultant ON application_spaces
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (
      SELECT project_id FROM projects WHERE consultant_id = auth.user_id()
    )
  );

ALTER TABLE space_design_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY space_design_overrides_admin ON space_design_overrides
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY space_design_overrides_consultant ON space_design_overrides
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (
      SELECT project_id FROM projects WHERE consultant_id = auth.user_id()
    )
  );

ALTER TABLE space_measurements ENABLE ROW LEVEL SECURITY;

CREATE POLICY space_measurements_admin ON space_measurements
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY space_measurements_consultant ON space_measurements
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (
      SELECT project_id FROM projects WHERE consultant_id = auth.user_id()
    )
  );

ALTER TABLE space_configurations ENABLE ROW LEVEL SECURITY;

CREATE POLICY space_configurations_admin ON space_configurations
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY space_configurations_consultant ON space_configurations
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (
      SELECT project_id FROM projects WHERE consultant_id = auth.user_id()
    )
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

-- Designer: create + update own DRAFT templates only
CREATE POLICY design_templates_designer_create ON design_templates
  FOR INSERT WITH CHECK (
    auth.user_role() = 'DESIGNER'
    AND created_by = auth.user_id()
  );

CREATE POLICY design_templates_designer_update ON design_templates
  FOR UPDATE USING (
    auth.user_role() = 'DESIGNER'
    AND created_by = auth.user_id()
    AND status = 'DRAFT'
  );

ALTER TABLE design_elements ENABLE ROW LEVEL SECURITY;

-- All staff can read
CREATE POLICY design_elements_staff_read ON design_elements
  FOR SELECT USING (auth.user_role() IN ('ADMIN', 'MANAGER', 'SALESPERSON', 'DESIGNER'));

-- Designer: write on own DRAFT templates
CREATE POLICY design_elements_designer_write ON design_elements
  FOR ALL USING (
    auth.user_role() = 'DESIGNER'
    AND template_id IN (
      SELECT template_id FROM design_templates
      WHERE created_by = auth.user_id() AND status = 'DRAFT'
    )
  );

-- Admin: full write
CREATE POLICY design_elements_admin ON design_elements
  FOR ALL USING (auth.user_role() = 'ADMIN');

ALTER TABLE template_consumables ENABLE ROW LEVEL SECURITY;

CREATE POLICY template_consumables_staff_read ON template_consumables
  FOR SELECT USING (auth.user_role() IN ('ADMIN', 'MANAGER', 'SALESPERSON', 'DESIGNER'));

CREATE POLICY template_consumables_designer_write ON template_consumables
  FOR ALL USING (
    auth.user_role() = 'DESIGNER'
    AND template_id IN (
      SELECT template_id FROM design_templates
      WHERE created_by = auth.user_id() AND status = 'DRAFT'
    )
  );

CREATE POLICY template_consumables_admin ON template_consumables
  FOR ALL USING (auth.user_role() = 'ADMIN');

ALTER TABLE digital_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY digital_assets_staff_read ON digital_assets
  FOR SELECT USING (auth.user_role() IN ('ADMIN', 'MANAGER', 'SALESPERSON', 'DESIGNER'));

CREATE POLICY digital_assets_designer_write ON digital_assets
  FOR ALL USING (
    auth.user_role() = 'DESIGNER'
    AND template_id IN (
      SELECT template_id FROM design_templates
      WHERE created_by = auth.user_id() AND status = 'DRAFT'
    )
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

-- Admin: full CRUD (direct create/edit/deactivate)
CREATE POLICY product_library_admin_write ON product_library
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Designer: insert only (propose new SKU — no pricing fields set by Designer)
CREATE POLICY product_library_designer_propose ON product_library
  FOR INSERT WITH CHECK (
    auth.user_role() = 'DESIGNER'
    AND status = 'PROPOSED'
    AND proposed_by = auth.user_id()
  );

-- Designer: update own REJECTED proposals (resubmit — Part 4, WF-10)
CREATE POLICY product_library_designer_resubmit ON product_library
  FOR UPDATE USING (
    auth.user_role() = 'DESIGNER'
    AND proposed_by = auth.user_id()
    AND status = 'REJECTED'
  );

ALTER TABLE pricing_settings ENABLE ROW LEVEL SECURITY;

-- Admin: full access
CREATE POLICY pricing_settings_admin ON pricing_settings
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Consultant: read only (needed for quotation engine display)
CREATE POLICY pricing_settings_consultant_read ON pricing_settings
  FOR SELECT USING (auth.user_role() = 'SALESPERSON');

-- ============================================================
-- DOMAIN 8 — Quotation & Commercial
-- ============================================================

ALTER TABLE quotation_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY quotation_snapshots_admin ON quotation_snapshots
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY quotation_snapshots_consultant ON quotation_snapshots
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (
      SELECT project_id FROM projects WHERE consultant_id = auth.user_id()
    )
  );

ALTER TABLE bom_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY bom_lines_admin ON bom_lines
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY bom_lines_consultant ON bom_lines
  FOR SELECT USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (
      SELECT project_id FROM projects WHERE consultant_id = auth.user_id()
    )
  );

ALTER TABLE configuration_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY configuration_line_items_admin ON configuration_line_items
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY configuration_line_items_consultant ON configuration_line_items
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (
      SELECT project_id FROM projects WHERE consultant_id = auth.user_id()
    )
  );

ALTER TABLE configured_furniture ENABLE ROW LEVEL SECURITY;

CREATE POLICY configured_furniture_admin ON configured_furniture
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY configured_furniture_consultant ON configured_furniture
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (
      SELECT project_id FROM projects WHERE consultant_id = auth.user_id()
    )
  );

ALTER TABLE review_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY review_records_admin ON review_records
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY review_records_consultant ON review_records
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (
      SELECT project_id FROM projects WHERE consultant_id = auth.user_id()
    )
  );

ALTER TABLE advance_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY advance_payments_admin ON advance_payments
  FOR ALL USING (auth.user_role() = 'ADMIN');

CREATE POLICY advance_payments_consultant ON advance_payments
  FOR ALL USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (
      SELECT project_id FROM projects WHERE consultant_id = auth.user_id()
    )
  );

-- ============================================================
-- DOMAIN 9 — Manufacturing & Fulfilment
-- ============================================================

ALTER TABLE manufacturing_packages ENABLE ROW LEVEL SECURITY;

-- Admin: full access (view/regenerate/download)
CREATE POLICY manufacturing_packages_admin ON manufacturing_packages
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Other staff: read only on relevant projects
CREATE POLICY manufacturing_packages_staff_read ON manufacturing_packages
  FOR SELECT USING (
    auth.user_role() IN ('MANAGER', 'SALESPERSON')
    AND project_id IN (
      SELECT project_id FROM projects
      WHERE consultant_id = auth.user_id() OR manager_id = auth.user_id()
    )
  );

ALTER TABLE installation_schedules ENABLE ROW LEVEL SECURITY;

-- Admin: full access
CREATE POLICY installation_schedules_admin ON installation_schedules
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Manager: full access on own managed projects
CREATE POLICY installation_schedules_manager ON installation_schedules
  FOR ALL USING (
    auth.user_role() = 'MANAGER'
    AND manager_id = auth.user_id()
  );

-- Consultant: read only
CREATE POLICY installation_schedules_consultant_read ON installation_schedules
  FOR SELECT USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (
      SELECT project_id FROM projects WHERE consultant_id = auth.user_id()
    )
  );

ALTER TABLE installation_reschedule_log ENABLE ROW LEVEL SECURITY;

-- Admin: full read
CREATE POLICY installation_reschedule_log_admin ON installation_reschedule_log
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Manager: read + insert on own managed projects
CREATE POLICY installation_reschedule_log_manager ON installation_reschedule_log
  FOR ALL USING (
    auth.user_role() = 'MANAGER'
    AND project_id IN (
      SELECT project_id FROM projects WHERE manager_id = auth.user_id()
    )
  );

-- ============================================================
-- DOMAIN 10 — Customer Portal Identity
-- ============================================================

ALTER TABLE customer_accounts ENABLE ROW LEVEL SECURITY;

-- Admin: full access
CREATE POLICY customer_accounts_admin ON customer_accounts
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Customers access own record only (via separate auth — handled at app layer)
-- Note: Customer auth is separate from staff auth. RLS for customer access
-- is enforced through the customer portal's service role + app-layer checks,
-- not directly through these policies (customers don't have staff JWTs).

ALTER TABLE customer_project_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_project_links_admin ON customer_project_links
  FOR ALL USING (auth.user_role() = 'ADMIN');

-- Consultant: read links for own projects
CREATE POLICY customer_project_links_consultant ON customer_project_links
  FOR SELECT USING (
    auth.user_role() = 'SALESPERSON'
    AND project_id IN (
      SELECT project_id FROM projects WHERE consultant_id = auth.user_id()
    )
  );

-- ============================================================
-- DOMAIN 11 — Platform Services
-- ============================================================

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Admin: full read
CREATE POLICY audit_log_admin_read ON audit_log
  FOR SELECT USING (auth.user_role() = 'ADMIN');

-- All staff: insert (system-generated audit entries)
CREATE POLICY audit_log_staff_insert ON audit_log
  FOR INSERT WITH CHECK (
    auth.user_role() IN ('ADMIN', 'MANAGER', 'SALESPERSON', 'DESIGNER')
  );

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can read/update their own notifications only
CREATE POLICY notifications_own ON notifications
  FOR ALL USING (recipient_id = auth.user_id());

-- System (service role) can insert notifications for anyone
-- (handled by service_role bypass, no explicit policy needed for inserts
-- from Edge Functions using the service_role key)
