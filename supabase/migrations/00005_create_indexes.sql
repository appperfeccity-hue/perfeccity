-- PERFECCITY MVP — Migration 00005: Partial unique indexes + performance indexes
-- Source of truth: Engineering Handover v7.0, Part 5
--
-- Three frozen partial unique indexes (non-negotiable):
-- 1. one_primary_wall_per_project
-- 2. one_active_package_per_project
-- 3. one_current_config_per_space
--
-- Plus standard performance indexes for common query patterns.

-- ============================================================
-- FROZEN PARTIAL UNIQUE INDEXES
-- ============================================================

-- At most one primary wall per project (DB-enforced max-one-primary).
-- Min-one-primary is app-enforced at Stage 4→5 transition (422 PRIMARY_WALL_REQUIRED).
CREATE UNIQUE INDEX one_primary_wall_per_project
  ON application_spaces(project_id)
  WHERE is_primary_wall = TRUE;

-- At most one live manufacturing package per project.
-- A FAILED row doesn't block the index, so regenerate can insert a fresh row
-- without deleting the failed one first.
CREATE UNIQUE INDEX one_active_package_per_project
  ON manufacturing_packages(project_id)
  WHERE status IN ('GENERATING', 'READY');

-- v7.0: At most one current configuration per space under concurrent regeneration.
-- Mirrors the two indexes above exactly.
CREATE UNIQUE INDEX one_current_config_per_space
  ON space_configurations(space_id)
  WHERE is_current = TRUE;

-- ============================================================
-- PERFORMANCE INDEXES — Common query patterns from Part 7/9
-- ============================================================

-- Domain 2: Lead queue (Manager view — unassigned, oldest first)
CREATE INDEX idx_leads_status_created
  ON leads(status, created_at)
  WHERE status = 'NEW';

-- Domain 2: Consultant's own leads
CREATE INDEX idx_leads_assigned_consultant
  ON leads(assigned_consultant_id)
  WHERE assigned_consultant_id IS NOT NULL;

-- Domain 3: Projects by status (multiple queue views)
CREATE INDEX idx_projects_status
  ON projects(status);

-- Domain 3: Projects by consultant (own projects view)
CREATE INDEX idx_projects_consultant
  ON projects(consultant_id);

-- Domain 3: Projects by manager (installation queue)
CREATE INDEX idx_projects_manager
  ON projects(manager_id)
  WHERE manager_id IS NOT NULL;

-- Domain 3: Project state history (timeline view)
CREATE INDEX idx_project_state_history_project
  ON project_state_history(project_id, created_at);

-- Domain 4: Site photographs (non-deleted, by project)
CREATE INDEX idx_site_photographs_project
  ON site_photographs(project_id)
  WHERE is_deleted = FALSE;

-- Domain 5: Spaces by project
CREATE INDEX idx_application_spaces_project
  ON application_spaces(project_id);

-- Domain 5: Space measurements (latest by space — MAX(created_at))
CREATE INDEX idx_space_measurements_space_created
  ON space_measurements(space_id, created_at DESC);

-- Domain 5: Current configuration per space (quick lookup)
CREATE INDEX idx_space_configurations_current
  ON space_configurations(space_id)
  WHERE is_current = TRUE;

-- Domain 6: Templates by status (Review Queue, Published Library)
CREATE INDEX idx_design_templates_status
  ON design_templates(status);

-- Domain 6: Templates by creator (Designer's own view)
CREATE INDEX idx_design_templates_created_by
  ON design_templates(created_by);

-- Domain 7: Product library by category and status (SKU picker)
CREATE INDEX idx_product_library_category_status
  ON product_library(category, status);

-- Domain 7: Product library — proposed queue (Admin review)
CREATE INDEX idx_product_library_proposed
  ON product_library(status)
  WHERE status = 'PROPOSED';

-- Domain 8: Quotation snapshots by project
CREATE INDEX idx_quotation_snapshots_project
  ON quotation_snapshots(project_id);

-- Domain 8: BOM lines by snapshot
CREATE INDEX idx_bom_lines_snapshot
  ON bom_lines(snapshot_id);

-- Domain 8: Configuration line items by config
CREATE INDEX idx_configuration_line_items_config
  ON configuration_line_items(config_id);

-- Domain 8: Configured furniture by space + config (v7.0 config-scoped)
CREATE INDEX idx_configured_furniture_space_config
  ON configured_furniture(space_id, config_id);

-- Domain 9: Manufacturing packages by project (status lookup)
CREATE INDEX idx_manufacturing_packages_project
  ON manufacturing_packages(project_id);

-- Domain 9: Reschedule log by project (timeline)
CREATE INDEX idx_installation_reschedule_log_project
  ON installation_reschedule_log(project_id, created_at);

-- Domain 10: Customer project links
CREATE INDEX idx_customer_project_links_customer
  ON customer_project_links(customer_id);

CREATE INDEX idx_customer_project_links_project
  ON customer_project_links(project_id);

-- Domain 11: Notifications by recipient (unread first)
CREATE INDEX idx_notifications_recipient_unread
  ON notifications(recipient_id, created_at DESC)
  WHERE is_read = FALSE;

-- Domain 11: Audit log by entity (lookup by entity_type + action)
CREATE INDEX idx_audit_log_entity
  ON audit_log(entity_type, action, created_at DESC);

-- Domain 1: Refresh tokens by user (session management)
CREATE INDEX idx_refresh_tokens_user
  ON refresh_tokens(user_id)
  WHERE revoked_at IS NULL;
