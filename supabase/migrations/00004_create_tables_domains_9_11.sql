-- PERFECCITY MVP — Migration 00004: Create tables for Domains 9–11
-- Source of truth: Engineering Handover v7.0, Part 5
--
-- Domain 9 — Manufacturing & Fulfilment (3 tables)
-- Domain 10 — Customer Portal Identity (2 tables)
-- Domain 11 — Platform Services (2 tables)
--
-- Total this migration: 7 tables
-- Running total across all migrations: 36 tables (complete)

-- ============================================================
-- DOMAIN 9 — Manufacturing & Fulfilment
-- ============================================================

CREATE TABLE manufacturing_packages (
  package_id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                   UUID NOT NULL REFERENCES projects(project_id),
  snapshot_id                  UUID NOT NULL REFERENCES quotation_snapshots(snapshot_id),
  status                       mfg_package_status_enum NOT NULL DEFAULT 'GENERATING',
  s3_manifest_key              VARCHAR,
  installation_drawings_s3_key VARCHAR,
  generated_by                 UUID REFERENCES users(user_id),
  generated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  ready_at                     TIMESTAMPTZ
);
-- Partial unique index added in migration 00005 (indexes).

CREATE TABLE installation_schedules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL UNIQUE REFERENCES projects(project_id), -- single-schedule rule
  manager_id      UUID NOT NULL REFERENCES users(user_id),
  scheduled_date  DATE NOT NULL,
  scheduled_slot  installation_slot_enum NOT NULL,
  status          installation_schedule_status_enum NOT NULL DEFAULT 'CONFIRMED',
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE installation_reschedule_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(project_id),
  old_date      DATE,
  new_date      DATE,
  old_slot      installation_slot_enum,
  new_slot      installation_slot_enum,
  requested_by  reschedule_actor_enum NOT NULL,
  reason        TEXT,
  actor_id      UUID REFERENCES users(user_id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Append-only log — no UPDATE/DELETE in normal operation.

-- Deferred FK from projects to installation_schedules
ALTER TABLE projects
  ADD CONSTRAINT fk_projects_latest_installation_schedule
  FOREIGN KEY (latest_installation_schedule_id) REFERENCES installation_schedules(id);

-- ============================================================
-- DOMAIN 10 — Customer Portal Identity
-- ============================================================

CREATE TABLE customer_accounts (
  customer_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id        UUID NOT NULL UNIQUE REFERENCES leads(lead_id), -- 1:1 with lead
  email          VARCHAR NOT NULL UNIQUE,
  password_hash  VARCHAR NOT NULL,
  status         customer_status_enum NOT NULL DEFAULT 'INVITED',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ
);

CREATE TABLE customer_project_links (
  link_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID NOT NULL REFERENCES customer_accounts(customer_id),
  project_id   UUID NOT NULL REFERENCES projects(project_id),
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- TODO (Part 15, item 3): UNIQUE(projects.lead_id) is recommended but not frozen.

-- ============================================================
-- DOMAIN 11 — Platform Services
-- ============================================================

CREATE TABLE audit_log (
  log_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID REFERENCES users(user_id),
  entity_type VARCHAR NOT NULL,
  action      VARCHAR NOT NULL,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Append-only. Column shape is an ERD-level placeholder (Part 5 note).
-- TODO (Part 15, item 8): Final column shapes not frozen — treat as provisional.

CREATE TABLE notifications (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id    UUID NOT NULL REFERENCES users(user_id),
  type            notification_type_enum NOT NULL,
  message         VARCHAR NOT NULL,
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- TODO (Part 15, item 5): recipient_id currently references users only.
-- Whether it needs to support customer_accounts via a recipient_type
-- discriminator is unresolved. Current FK targets users(user_id) only.
-- TODO (Part 15, item 8): Column shape is provisional.
-- TODO (Part 15, item 9): Confirm all 9 notification_type_enum values for MVP.
