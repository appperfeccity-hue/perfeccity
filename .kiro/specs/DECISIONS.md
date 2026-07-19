# PERFECCITY MVP — Architectural Decisions Log

Running record of decisions made during implementation. Each decision is numbered,
attributed to a sprint, and includes rationale + trade-offs. Sprint-specific spec
files reference this document rather than embedding decisions inline where they'd
get lost.

This file is append-only within a sprint. Reversing a decision requires a new entry
(not an edit to the old one) citing the reversal reason.

---

## Sprint 1 Decisions

| ID | Decision | Rationale | Trade-off | Frozen? |
|---|---|---|---|---|
| AD-1 | JWT expiry = 900s (15min), override Supabase default 3600s | Balances role-change propagation speed vs. token refresh overhead | Suspended user can act for up to 15min. Real-time revocation (token blocklist) is Layer 2. | Yes |
| AD-2 | `users.user_id` = Supabase Auth UID directly | Zero mapping overhead; `auth.uid()` == `users.user_id` everywhere | Seed script must create Auth entries with same UUIDs. Migration of existing users if Auth is ever swapped would need a mapping. | Yes |
| AD-3 | `customer_accounts.auth_user_id` column added (not in v7.0 ERD) | Supabase Auth integration requires linking customer profile to Auth entry | Schema addition beyond frozen v7.0 — flagged as infra-necessitated, not Part 15. | Yes |
| AD-4 | Single Supabase Auth instance (staff + customer), discriminated by `app_metadata.role` | Avoids dual-Auth complexity | Namespace middleware is the second guard layer; if it fails, RLS is the last defense. | Yes |
| AD-5 | Assignment RPC is `SECURITY DEFINER` + `SET search_path = public` | Manager's RLS can't write `assigned_by_manager_id` directly; function must bypass RLS | Requires explicit `search_path` lock to prevent privilege escalation. | Yes |
| AD-6 | Assignment RPC performs full transition atomically (status + activity + notification) | Guard without audit trail is incomplete — all three must be in same transaction | Function is larger but eliminates partial-failure states. | Yes |
| AD-7 | Hook requires `GRANT EXECUTE TO supabase_auth_admin` + registration in config.toml | Without grant+registration, hook exists but is never called — tokens silently lack role | Easy to miss; added as explicit task with negative test. | Yes |
| AD-8 | RLS policies use STABLE helper functions for project ownership subqueries | Inline `project_id IN (SELECT ...)` re-evaluates per-row and compounds badly in Sprint 4+ joins across domains | Slightly more complex migration; helper functions must stay in sync with schema changes to `projects`. | Yes |
| AD-9 | `auth.user_role()` reads from `app_metadata` ONLY (not `user_metadata`) | Custom token hook writes exclusively to `app_metadata`; reading both is a fallback that masks hook registration failures | Removes graceful degradation if hook isn't registered — but that's caught by the negative test (AD-7). | Yes |
| AD-10 | Enum count in `00001_create_enums.sql` is 39 (not 37) | Part 6 table lists 38 named types; `asset_type_enum` is 39th, required by `digital_assets.asset_type` in Part 5 but editorially omitted from Part 6. No orphaned types present (price_group_enum, pdf_job_status_enum confirmed absent). | None — editorial correction only. | Yes |

---

## Pending (Future Sprints)

_Decisions that are expected to be needed but haven't been made yet._

- **Sprint 3:** `payment_method_enum` — whether to add `NET_BANKING`/`EMI` (Part 15, item 7)
- **Sprint 6:** Customer RLS via `customer_accounts.auth_user_id` — exact policy shape
  depends on how customer project links are populated during the convert flow
