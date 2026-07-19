-- PERFECCITY MVP — Migration 00003: Create tables for Domains 5–8
-- Source of truth: Engineering Handover v7.0, Part 5
--
-- Domain 5 — Space & Design Configuration (4 tables)
-- Domain 6 — Design Template Library (4 tables)
-- Domain 7 — SKU & Pricing Master (2 tables)
-- Domain 8 — Quotation & Commercial (6 tables)
--
-- Total this migration: 16 tables

-- ============================================================
-- DOMAIN 5 — Space & Design Configuration
-- ============================================================

CREATE TABLE application_spaces (
  space_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id             UUID NOT NULL REFERENCES projects(project_id),
  space_type             space_type_enum NOT NULL,
  wall_shape             wall_shape_enum,
  primary_parameter_value VARCHAR,
  planning_notes         TEXT,
  selected_template_id   UUID, -- FK added after design_templates exists
  sample_verified        BOOLEAN NOT NULL DEFAULT FALSE,
  sample_verified_at     TIMESTAMPTZ,
  width_mm               INTEGER,
  height_mm              INTEGER,
  segment_b_mm           INTEGER,
  segment_c_mm           INTEGER,
  opening_deduction_sqmm BIGINT,
  gross_area_sqmm        BIGINT,
  net_area_sqmm          BIGINT,
  is_primary_wall        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Partial unique index added in migration 00005 (indexes).

CREATE TABLE space_design_overrides (
  override_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id        UUID NOT NULL REFERENCES application_spaces(space_id),
  project_id      UUID NOT NULL REFERENCES projects(project_id),
  attribute_name  VARCHAR NOT NULL,
  override_value  VARCHAR,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE space_measurements (
  measurement_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id               UUID NOT NULL REFERENCES application_spaces(space_id),
  project_id             UUID NOT NULL REFERENCES projects(project_id),
  width_mm               INTEGER NOT NULL,
  height_mm              INTEGER NOT NULL,
  segment_b_mm           INTEGER,
  segment_c_mm           INTEGER,
  opening_deduction_sqmm BIGINT DEFAULT 0,
  gross_area_sqmm        BIGINT NOT NULL,
  net_area_sqmm          BIGINT NOT NULL,
  recorded_by            UUID REFERENCES users(user_id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Append-only: one row per Stage-7 submission.
-- "Latest" recoverable via MAX(created_at) per space_id — no is_latest flag needed.

CREATE TABLE space_configurations (
  config_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id           UUID NOT NULL REFERENCES application_spaces(space_id),
  project_id         UUID NOT NULL REFERENCES projects(project_id),
  template_id        UUID, -- FK added after design_templates exists
  installation_type  installation_type_enum,
  back_board_mm      SMALLINT DEFAULT 0,
  configuration_hash VARCHAR,
  is_current         BOOLEAN NOT NULL DEFAULT FALSE,
  generated_by       VARCHAR,
  generated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Partial unique index added in migration 00005 (indexes).
-- configuration_hash is deliberately NOT unique (Part 5, Domain 5 note).
-- TODO (Part 15, item 4): Whether reverting to a prior identical config
-- should insert a new row (per R9) or reuse existing is unresolved.

-- ============================================================
-- DOMAIN 6 — Design Template Library
-- ============================================================

CREATE TABLE design_templates (
  template_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection             design_collection_enum,
  space_type             space_type_enum,
  template_name          VARCHAR NOT NULL,
  theme                  VARCHAR,
  tags                   TEXT[],
  price_range            VARCHAR,
  template_type          template_type_enum,
  wall_shape             wall_shape_enum,
  default_wall_width_mm  INTEGER,
  default_wall_height_mm INTEGER,
  min_width_mm           INTEGER,
  max_width_mm           INTEGER,
  min_height_mm          INTEGER,
  max_height_mm          INTEGER,
  wall_type              wall_type_enum,
  installation_type      installation_type_enum,
  compatible_materials   material_preference_enum[],
  compatible_spaces      space_type_enum[],
  status                 template_status_enum NOT NULL DEFAULT 'DRAFT',
  created_by             UUID REFERENCES users(user_id),
  published_at           TIMESTAMPTZ,
  archived_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Now add deferred FKs from Domain 5 to design_templates
ALTER TABLE application_spaces
  ADD CONSTRAINT fk_application_spaces_selected_template
  FOREIGN KEY (selected_template_id) REFERENCES design_templates(template_id);

ALTER TABLE space_configurations
  ADD CONSTRAINT fk_space_configurations_template
  FOREIGN KEY (template_id) REFERENCES design_templates(template_id);

-- ============================================================
-- DOMAIN 7 — SKU & Pricing Master
-- (created before design_elements/template_consumables because they FK to it)
-- ============================================================

CREATE TABLE product_library (
  sku               VARCHAR PRIMARY KEY, -- natural key, immutable for life
  category          sku_category_enum NOT NULL,
  name              VARCHAR NOT NULL,
  unit              VARCHAR NOT NULL,
  unit_cost_paise   BIGINT,
  sell_price_paise  BIGINT,
  material_family   material_preference_enum,
  furniture_category furniture_category_enum,
  width_mm          INTEGER,       -- v7.0: numeric source of truth for R4
  height_mm         INTEGER,       -- v7.0: CEIL(net_area_sqmm/(width_mm×height_mm))
  thickness_mm      INTEGER,       -- v7.0: nullable — not meaningful for all categories
  dimensions        VARCHAR,       -- v7.0: display-only, derived from numeric fields
  is_active         BOOLEAN NOT NULL DEFAULT TRUE, -- derived: TRUE iff status='ACTIVE'
  status            product_status_enum NOT NULL DEFAULT 'ACTIVE',
  proposed_by       UUID REFERENCES users(user_id),
  created_by        UUID REFERENCES users(user_id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pricing_settings (
  key          VARCHAR PRIMARY KEY,
  value_paise  BIGINT NOT NULL,
  description  VARCHAR,
  updated_by   UUID REFERENCES users(user_id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- DOMAIN 6 continued — Design Elements & Assets
-- (after product_library exists for FK)
-- ============================================================

CREATE TABLE design_elements (
  element_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id      UUID NOT NULL REFERENCES design_templates(template_id),
  sku              VARCHAR NOT NULL REFERENCES product_library(sku),
  product_role     product_role_enum NOT NULL,
  default_quantity DECIMAL,
  colour_variant   VARCHAR,
  finish_variant   VARCHAR,
  default_position VARCHAR
);

CREATE TABLE template_consumables (
  consumable_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id      UUID NOT NULL REFERENCES design_templates(template_id),
  sku              VARCHAR NOT NULL REFERENCES product_library(sku),
  quantity_formula VARCHAR,
  condition_field  VARCHAR,
  condition_value  VARCHAR
);

CREATE TABLE digital_assets (
  asset_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES design_templates(template_id),
  asset_type  asset_type_enum NOT NULL,
  s3_key      VARCHAR NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  uploaded_by UUID REFERENCES users(user_id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- DOMAIN 8 — Quotation & Commercial
-- ============================================================

CREATE TABLE quotation_snapshots (
  snapshot_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(project_id),
  status            snapshot_status_enum NOT NULL DEFAULT 'DRAFT',
  grand_total_paise BIGINT,
  step_breakdown    JSONB,
  sha256_hash       VARCHAR,
  seal_payload      JSONB,
  sealed_at         TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  generated_by      UUID REFERENCES users(user_id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- configured_furniture must be created before bom_lines (FK dependency)
CREATE TABLE configured_furniture (
  furniture_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id             UUID NOT NULL REFERENCES application_spaces(space_id),
  project_id           UUID NOT NULL REFERENCES projects(project_id),
  config_id            UUID NOT NULL REFERENCES space_configurations(config_id), -- v7.0: config-scoped
  sku                  VARCHAR NOT NULL REFERENCES product_library(sku),
  quantity             INTEGER NOT NULL DEFAULT 1,
  default_position     VARCHAR,
  colour_variant       VARCHAR,
  unit_cost_paise      BIGINT NOT NULL,
  calculated_cost_paise BIGINT NOT NULL, -- = quantity × unit_cost_paise, computed on write
  added_by             UUID REFERENCES users(user_id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bom_lines (
  line_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(project_id),
  snapshot_id      UUID NOT NULL REFERENCES quotation_snapshots(snapshot_id),
  space_id         UUID REFERENCES application_spaces(space_id),
  furniture_id     UUID REFERENCES configured_furniture(furniture_id),
  sku              VARCHAR REFERENCES product_library(sku),
  source           bom_source_enum NOT NULL,
  component_label  VARCHAR NOT NULL,
  quantity         DECIMAL NOT NULL,
  unit_label       VARCHAR NOT NULL,
  unit_cost_paise  BIGINT NOT NULL,
  line_total_paise BIGINT NOT NULL,
  generated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- TODO (Part 15, item 2): bom_lines conditional nullability —
-- Recommended: source=WALL_PANEL → space_id, sku NOT NULL;
-- source=FURNITURE → furniture_id, sku NOT NULL;
-- source=CONSUMABLE → sku NOT NULL.
-- Not frozen — needs decision before adding CHECK constraints.

CREATE TABLE configuration_line_items (
  line_item_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id         UUID NOT NULL REFERENCES space_configurations(config_id),
  project_id        UUID NOT NULL REFERENCES projects(project_id),
  space_id          UUID NOT NULL REFERENCES application_spaces(space_id),
  sku               VARCHAR NOT NULL REFERENCES product_library(sku),
  product_role      product_role_enum NOT NULL,
  quantity          DECIMAL NOT NULL,
  unit_label        VARCHAR NOT NULL,
  unit_cost_paise   BIGINT NOT NULL,
  sell_price_paise  BIGINT NOT NULL,
  group_name        bom_source_enum NOT NULL,
  generated_by_rule VARCHAR, -- 'R4', 'R5', 'R6', 'R7', or 'MANUAL'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE review_records (
  review_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(project_id),
  reviewed_by     UUID NOT NULL REFERENCES users(user_id),
  result          review_result_enum NOT NULL,
  checklist_json  JSONB, -- 7-item WF-4 checklist, each item's pass/fail
  failure_reasons TEXT[],
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE advance_payments (
  payment_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL UNIQUE REFERENCES projects(project_id), -- single-payment rule
  amount_paise  BIGINT NOT NULL,
  method        payment_method_enum NOT NULL,
  status        advance_payment_status_enum NOT NULL DEFAULT 'PENDING',
  confirmed_by  UUID REFERENCES users(user_id),
  confirmed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Deferred FKs from projects to Domain 8 tables
-- ============================================================

ALTER TABLE projects
  ADD CONSTRAINT fk_projects_latest_snapshot
  FOREIGN KEY (latest_snapshot_id) REFERENCES quotation_snapshots(snapshot_id);

ALTER TABLE projects
  ADD CONSTRAINT fk_projects_latest_review
  FOREIGN KEY (latest_review_id) REFERENCES review_records(review_id);
