-- PERFECCITY MVP — Migration 00009: Login rate limiting table
-- Source: Sprint 1 T3; Part 7 (429 RATE_LIMITED, 10 failed/IP/15min)
--
-- Design decision: Postgres-backed rate limiting.
-- - No external dependency (Redis/Upstash not in MVP stack)
-- - Table stores only failed attempts (successful logins don't write here)
-- - Self-cleaning: each rate-limit check deletes expired rows (>15min old)
-- - Tiny table in practice: only active attack patterns accumulate rows
-- - Indexed on (ip_address, created_at) for the check query

CREATE TABLE login_attempts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address  INET NOT NULL,
  email       VARCHAR, -- for audit/debugging, not part of the rate limit key
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_login_attempts_ip_time
  ON login_attempts(ip_address, attempted_at DESC);

-- RLS: No user-facing access to this table. Edge Functions use service_role
-- to insert/query, so RLS is enabled but only service_role bypasses it.
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;

-- No policies needed — service_role bypasses RLS entirely.
-- If we ever need a dashboard view, add an Admin SELECT policy.

COMMENT ON TABLE login_attempts IS
  'Failed login attempt tracker for rate limiting (10 failures/IP/15min). '
  'Self-cleaning: expired rows purged on each check. Service-role only access.';
