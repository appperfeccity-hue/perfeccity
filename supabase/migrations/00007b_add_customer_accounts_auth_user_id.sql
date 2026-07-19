-- PERFECCITY MVP — Migration 00007b: Add auth_user_id to customer_accounts
-- Source: Sprint 1 spec, T1; Architectural Decision AD-3
--
-- CONTEXT: This column does NOT exist in the frozen v7.0 ERD (Part 5).
-- It is an infra-necessitated addition required by Supabase Auth integration —
-- NOT a Part 15 business-rule decision. The distinction matters:
-- - Part 15 items are frozen pending sign-off on business logic
-- - This column exists solely because Supabase Auth needs a link between
--   its internal auth.users table and our customer_accounts profile table
--
-- The frozen ERD's customer_accounts table has: customer_id, lead_id, email,
-- password_hash, status, created_at, updated_at, last_login_at.
-- This migration adds auth_user_id as the bridge to Supabase Auth.
--
-- With AD-4 (single Auth instance), customers authenticate via the same
-- Supabase Auth as staff, with app_metadata.role = 'CUSTOMER'. This column
-- links their Auth UID to their customer profile.
--
-- Note: password_hash on customer_accounts becomes redundant once Supabase Auth
-- manages credentials, but we keep it per the frozen schema — it may serve as
-- a backup verification mechanism or be dropped in a future migration.

ALTER TABLE customer_accounts
  ADD COLUMN auth_user_id UUID UNIQUE;

-- FK to auth.users — Supabase Auth's internal users table.
-- This reference is intentionally nullable for now: existing customer_accounts
-- rows (if any from seed) won't have an Auth entry yet. New customers created
-- through the proper flow will always have this populated.
COMMENT ON COLUMN customer_accounts.auth_user_id IS
  'Supabase Auth UID — links customer profile to auth.users entry. '
  'Infra-necessitated column (AD-3), not in frozen v7.0 ERD.';

-- Note: We do NOT add a FK constraint to auth.users(id) here because:
-- 1. The auth schema is managed by Supabase and may not allow cross-schema FKs
--    depending on the deployment (local vs hosted have different permissions)
-- 2. Referential integrity is enforced at the application layer during the
--    customer creation flow (atomic: create Auth user → insert customer_accounts)
-- 3. If the constraint is possible in the target environment, it can be added
--    as a follow-up with: ALTER TABLE customer_accounts ADD CONSTRAINT
--    fk_customer_auth_user FOREIGN KEY (auth_user_id) REFERENCES auth.users(id)
