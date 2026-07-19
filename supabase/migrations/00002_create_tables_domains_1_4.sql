-- PERFECCITY MVP — Migration 00002: Create tables for Domains 1–4
-- Source of truth: Engineering Handover v7.0, Part 5
--
-- Domain 1 — Authentication & Identity (3 tables)
-- Domain 2 — Lead & Acquisition (2 tables)
-- Domain 3 — Project & Workflow Core (3 tables)
-- Domain 4 — Consultation Discovery (5 tables)
--
-- Total this migration: 13 tables

-- ============================================================
-- DOMAIN 1 — Authentication & Identity
-- ============================================================

CREATE TABLE users (
  user_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR NOT NULL UNIQUE,
  password_hash VARCHAR NOT NULL,
  role          user_role_enum NOT NULL,
  status        user_status_enum NOT NULL DEFAULT 'PENDING_SETUP',
  full_name     VARCHAR NOT NULL,
  mobile        VARCHAR,
  department    VARCHAR,
  created_by    UUID REFERENCES users(user_id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE refresh_tokens (
  token_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(user_id),
  token_hash VARCHAR NOT NULL UNIQUE,
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  ip_address INET,
  user_agent VARCHAR
);

CREATE TABLE password_reset_tokens (
  token_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(user_id),
  token_hash VARCHAR NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);

-- ============================================================
-- DOMAIN 2 — Lead & Acquisition
-- ============================================================

CREATE TABLE leads (
  lead_id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name           VARCHAR NOT NULL,
  mobile_encrypted        BYTEA NOT NULL,
  mobile_hash             VARCHAR NOT NULL UNIQUE,
  email_address           VARCHAR,
  project_address         TEXT,
  city                    VARCHAR,
  project_type            project_type_enum,
  lead_source             lead_source_enum,
  communication_preference VARCHAR,
  assigned_consultant_id  UUID REFERENCES users(user_id),
  status                  lead_status_enum NOT NULL DEFAULT 'NEW',
  scheduled_date          TIMESTAMPTZ,
  lost_reason             lost_reason_enum,
  lost_notes              TEXT,
  converted_project_id    UUID, -- FK added after projects table exists
  duplicate_flag          BOOLEAN DEFAULT FALSE,
  created_by              UUID REFERENCES users(user_id),
  assigned_by_manager_id  UUID REFERENCES users(user_id),
  assigned_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE lead_activities (
  activity_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       UUID NOT NULL REFERENCES leads(lead_id),
  actor_id      UUID NOT NULL REFERENCES users(user_id),
  activity_type VARCHAR NOT NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- DOMAIN 3 — Project & Workflow Core
-- ============================================================

CREATE TABLE projects (
  project_id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id                          UUID REFERENCES leads(lead_id),
  consultant_id                    UUID NOT NULL REFERENCES users(user_id),
  manager_id                       UUID REFERENCES users(user_id),
  status                           project_status_enum NOT NULL DEFAULT 'PROJECT_CREATED',
  project_type                     project_type_enum,
  customer_name                    VARCHAR NOT NULL,
  project_address                  TEXT,
  city                             VARCHAR,
  installation_scheduled_date      TIMESTAMPTZ,
  latest_snapshot_id               UUID, -- FK added after quotation_snapshots exists
  latest_review_id                 UUID, -- FK added after review_records exists
  latest_installation_schedule_id  UUID, -- FK added after installation_schedules exists
  created_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- TODO (Part 15, item 1): Pointer FK integrity — projects.latest_snapshot_id,
-- latest_review_id, latest_installation_schedule_id should each reference a row
-- whose own project_id matches the parent project. Needs composite FK or trigger.
-- Not implemented until sign-off.

-- Now add the deferred FK from leads to projects
ALTER TABLE leads
  ADD CONSTRAINT fk_leads_converted_project
  FOREIGN KEY (converted_project_id) REFERENCES projects(project_id);

CREATE TABLE project_state_history (
  history_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(project_id),
  from_status  project_status_enum,
  to_status    project_status_enum NOT NULL,
  actor_id     UUID REFERENCES users(user_id),
  trigger_rule VARCHAR,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE consultation_stages (
  stage_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(project_id),
  stage_number  SMALLINT NOT NULL,
  status        stage_status_enum NOT NULL DEFAULT 'PENDING',
  completed_at  TIMESTAMPTZ,
  completed_by  UUID REFERENCES users(user_id),
  UNIQUE (project_id, stage_number)
);

-- ============================================================
-- DOMAIN 4 — Consultation Discovery
-- ============================================================

CREATE TABLE lifestyle_assessments (
  assessment_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id               UUID NOT NULL UNIQUE REFERENCES projects(project_id),
  family_member_count      SMALLINT,
  has_children             BOOLEAN,
  has_senior_citizens      BOOLEAN,
  has_pets                 BOOLEAN,
  work_from_home           BOOLEAN,
  storage_need             VARCHAR,
  maintenance_expectation  VARCHAR,
  preferred_style_notes    TEXT,
  samples_shown            TEXT[],
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE budget_profiles (
  profile_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL UNIQUE REFERENCES projects(project_id),
  budget_tier           budget_tier_enum NOT NULL,
  priority_spaces       space_type_enum[],
  interest_in_upgrades  BOOLEAN DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE site_assessments (
  assessment_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         UUID NOT NULL UNIQUE REFERENCES projects(project_id),
  wall_type          wall_type_enum,
  moisture_level     moisture_level_enum,
  has_electrical     BOOLEAN,
  lift_available     BOOLEAN,
  parking_available  BOOLEAN,
  site_notes         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE site_photographs (
  photo_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(project_id),
  s3_key          VARCHAR NOT NULL,
  original_name   VARCHAR,
  file_size_bytes INTEGER,
  mime_type       VARCHAR,
  uploaded_by     UUID REFERENCES users(user_id),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_deleted      BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE design_dna (
  dna_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL UNIQUE REFERENCES projects(project_id),
  design_style          design_style_enum,
  colour_palette        colour_palette_enum,
  material_preference   material_preference_enum,
  finish_preference     finish_preference_enum,
  lighting_preference   lighting_preference_enum,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
