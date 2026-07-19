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
| AD-9 | `auth.user_role()` reads from `app_metadata` ONLY (not `user_metadata`) | **Security fix, not just optimization.** `user_metadata` is client-writable via Supabase JS SDK (`updateUser()`). If policies resolved role from `user_metadata` first, any user could self-elevate to ADMIN by editing their own metadata. The previous version read `user_metadata` with `app_metadata` as fallback — this was a privilege escalation vulnerability, not a stylistic choice. | Removes graceful degradation if hook isn't registered — but that's caught by the negative test (AD-7). **Do not revert this to a coalesce/fallback pattern.** | Yes |
| AD-10 | Enum count in `00001_create_enums.sql` is 39 (not 37) | Part 6 table lists 38 named types; `asset_type_enum` is 39th, required by `digital_assets.asset_type` in Part 5 but editorially omitted from Part 6. No orphaned types present (price_group_enum, pdf_job_status_enum confirmed absent). | None — editorial correction only. | Yes |
| AD-11 | All RLS helper functions require explicit `GRANT EXECUTE TO authenticated, service_role` | Without grants, SECURITY DEFINER functions are not callable by authenticated users — policies fail **closed** (permission denied error), not fail **safe** (empty result set). This is a security-critical correctness issue, not optional. | Grants must be maintained if new helper functions are added in future sprints. | Yes |
| AD-12 | User creation uses COMPENSATING DELETE on partial failure (not upsert-on-retry) | Creating a user requires Auth + DB insert. If Auth succeeds but DB insert fails, delete the orphaned Auth user immediately. Failure of the compensating delete writes to `audit_log` (durable, queryable by Admin) — not just console.error. | Caller must retry the entire operation on failure (idempotent via Idempotency-Key). Rejected alternative: upsert-on-retry requires tracking partial creation state, more complex for a <0.1% failure case. | Yes |
| AD-13 | Rate limiting uses Postgres table (`login_attempts`), not in-memory or Redis | Edge Functions are stateless per-invocation — no in-memory counter survives between calls. Redis/Upstash would add an external dependency not in the MVP stack. Postgres table is self-cleaning (expired rows purged on each check), indexed on `(ip_address, attempted_at)`, tiny in practice. | Adds one DB write per failed login + one read per login attempt. Acceptable at MVP scale. **Known tradeoffs:** (a) IP-only key means a shared NAT/office WiFi could lock out all users behind it after 10 failures from any user — acceptable for MVP, flagged for Layer 2 if evidence emerges. (b) Doesn't protect against distributed attacks (rotating IPs). (c) Delete-then-count is two round-trips, not atomic — under extreme concurrency an attacker might get 11-12 attempts instead of 10. Functionally irrelevant for anti-abuse (threshold is 10, not 1). A Postgres function wrapping both would eliminate this but adds complexity for zero practical benefit at MVP scale. | Yes |
| AD-14 | Login-time status check reads from `public.users` (DB), not from JWT `app_metadata` | At login time no JWT exists yet — you can't check a claim that hasn't been issued. The hook enriches subsequent tokens; login is the initial gate. T3 queries `public.users.status` directly; T5/rbac.ts checks `app_metadata.user_status` on subsequent requests. | Two enforcement points (login + per-request) with different sources. Both required. | Yes |
| AD-15 | "First login without hook enrichment" race condition does NOT exist | T2's `createUser` call sets `app_metadata: {role, user_status}` directly via Admin API. The hook only fires on *subsequent* token refreshes. First token already has correct metadata from creation. Race would only exist if Auth users were created outside T2 (operational error, not a code path). | No workaround needed. Defensive-only concern. | Yes |
| AD-16 | Staff and customer login share one `login_attempts` table/counter | Rate limit is IP-keyed, not namespace-keyed. An attacker alternating between `/api/v1/auth/login` and `/customer/v1/auth/login` from the same IP should not get double the attempts. Splitting would mean 20 attempts before lockout. | A shared NAT where both staff and customers connect locks out everyone after 10 total failures from any user on that IP. Acceptable for MVP. | Yes |
| AD-17 | Mobile encryption uses AES-256-GCM (`MOBILE_ENCRYPTION_KEY`) + HMAC-SHA256 (`MOBILE_HASH_KEY`) — two separate secrets | **Encryption key:** AES-256-GCM, fresh IV per encryption, stored as bytea. **Hash key:** HMAC-SHA256 (NOT plain SHA-256 — Indian mobiles have ~33 bits of structured entropy, trivially reversible without a keyed hash). Two keys because: different rotation implications, defense-in-depth (compromise of one doesn't compromise the other). Both stored in Supabase secrets (`supabase secrets set`), never in code. | (a) Admin must use API to view mobile (not raw SQL). (b) **No key rotation path for MVP** — rotating either key requires re-processing all rows with downtime or dual-key window. This is a deliberate MVP acceptance, not a gap to discover later. (c) Both keys 64-char hex (`openssl rand -hex 32`). | Yes |
| AD-18 | RPC exception messages are matched by string in Edge Functions — co-maintenance markers added | Supabase PostgREST doesn't reliably surface Postgres ERRCODE in the client error object (it's in `message` not `code`). Edge Functions match on exception message text (e.g., `'LEAD_ALREADY_ASSIGNED'`). Each `RAISE EXCEPTION` site has a `⚠️ CO-MAINTENANCE` comment naming the matching file. | Fragile: renaming an exception message without updating the Edge Function collapses all 5 guards to a generic 500. This is acceptable for MVP (5 exception sites, one matching function, comments link them). A more robust pattern (e.g., returning error codes via a JSONB return value instead of exceptions) would eliminate this but changes the RPC's control flow design. | Yes |

---

## Sprint 2 Decisions

| ID | Decision | Rationale | Trade-off | Frozen? |
|---|---|---|---|---|
| AD-19 | Stage 4 space replacement uses a Postgres RPC (`replace_project_spaces`) for atomicity | The original two-call pattern (delete then insert from Edge Function) has a partial-failure gap: if delete succeeds but insert fails, project is left with zero spaces — worse than either old or new state, silent, and the same category of risk T2's compensating-delete solved. Wrapping in a Postgres function means if insert fails, the delete is rolled back (transactional). | Adds a migration (00010) and an RPC call pattern. Consistent with T7's `assign_lead_to_consultant` — any multi-step write that can leave a worse-than-either-side state should be a DB function, not multiple Edge Function round-trips. **Sprint 4 dependency:** the DELETE in this RPC will FK-fail once `space_configurations`/`space_measurements` etc. reference spaces (Sprint 4+). At that point, Stage 4 resubmission must either be blocked when downstream data exists, or the RPC must cascade. Decision deferred to Sprint 4 — documented here so it's not discovered as a runtime FK error. | Yes |
| AD-20 | Self-approval guard on SKU approve: `proposed_by != approver` enforced at DB | Structurally unreachable in production (DESIGNER ≠ ADMIN, single role per user), but enforced for defense-in-depth. Does NOT address rubber-stamping (business-process concern). Frozen assumption: single-role-per-user; if ever multi-role, this becomes real enforcement, not just defense-in-depth. | DB guard exists even though unreachable today. Flag for revisit if role model changes. | Yes |
| AD-21 | Two-call writes acceptable when partial failure is **visible and non-corrupt** | Principle: not every multi-step write needs an RPC. An RPC is needed when partial failure leaves a **worse-than-either-side state** (e.g., zero spaces, orphaned Auth user). Two separate calls are acceptable when: (a) the first write completes a valid state on its own (e.g., status is correctly updated), and (b) failure of the second write (e.g., notification insert) doesn't leave the system in a state that contradicts reality or requires manual repair — it just means someone isn't alerted until they check manually. **Test for "visible":** if the notification fails, does the actor who needs to know eventually discover the state change through another path (e.g., polling a queue, checking a list view)? If yes → two calls acceptable. If no → RPC needed. **Applied to:** template submit (status change is the truth; notification is a convenience), SKU reject (status is correct; Designer sees it in Submissions view). **NOT applied to:** SKU approve (pricing must be set atomically with status — if status=ACTIVE but pricing is NULL, the SKU appears in the catalogue with no price, which is corrupt). | Must be evaluated per-case, not blanket-applied. Each application documented inline in the relevant file header. | Yes |

---

## Sprint 4 Decisions

| ID | Decision | Rationale | Trade-off | Frozen? |
|---|---|---|---|---|
| AD-22 | `segment_b_mm = 0` for L_SHAPE is valid input (resolved as straight geometry) — SI-1 CONFIRMED | Confirmed by Akshay. Reasoning: (1) formula handles 0 cleanly (no math error), (2) rejecting would dead-end against T0's stage lock (wall_shape set at Stage 4, measurements at Stage 7), (3) deterministic (0 always produces the same valid result), (4) better UX (Consultants discover on-site that a corner is effectively straight). **Spec wording:** "L_SHAPE permits segment_b_mm >= 0. When 0, Geometry Engine SHALL resolve as straight for all layout/BOM/pricing. wall_shape value unchanged for audit." | `wall_shape = L_SHAPE` in the DB while geometry is straight — cosmetic inconsistency preserved deliberately for audit trail. No silent normalization of the stored `wall_shape` value. | Yes |
| AD-23 | `PER_RFT_HEIGHT` uses `/1000` exactly as frozen spec states — SI-2 CONFIRMED | Confirmed: the frozen specification is the source of truth for deterministic calculations. `/1000` produces height in meters × factor. The "RFT" in the name is a naming inconsistency in the spec, not an implementation error — silently substituting `/304.8` would mean the implementation no longer matches the frozen specification, changing BOM quantities by 3.28× and breaking quotation reproducibility. Any change to `/304.8` requires a formal specification revision. **Real-world sanity check (action item):** The first time R5's trim output is compared against an actual physical trim order, verify that `/1000` produces quantities that match real-world running-feet ordering. If trim shipments consistently run short by ~3.28×, that's evidence the spec has a typo — route through a formal spec amendment at that point, not a silent code fix. | The naming inconsistency persists (formula called "RFT" but produces meters). This is documented, not "fixed" — the math is authoritative, the name is misleading. | Yes |
| AD-24 | R5 uses pre-linked TRIM from template (not runtime search) + validates colour/finish compatibility — SI-3 CONFIRMED | R5 SHALL use the TRIM design element pre-selected by the Designer at template design time. The engine SHALL NOT perform a live search across product_library to discover a trim SKU. The engine SHALL validate that the attached TRIM SKU is ACTIVE AND that its colour/finish attributes are compatible with the resolved panel. **Why not runtime search:** frozen architecture favors predefined products, deterministic configuration, metadata-first resolution. Runtime search would make results depend on product_library state at config time, not template design time. **Why runtime validation:** a trim could be deactivated post-publish, or a Designer could attach a mismatched trim (data-entry error). "Matching" has semantic meaning: engine validates the match, doesn't discover it. | Template is source of truth for which trim SKU. Engine responsibility is validate, not select. A template with a wrong trim will fail at configuration time (TRIM_VARIANT_MISMATCH), not silently produce wrong BOM. | Yes |

---

## Cross-AD Interactions (reviewed end-to-end after Sprint 1 completion)

Checked for contradictions or unintended coupling between all 18 decisions:

- **AD-7 × AD-9:** Intentionally coupled. Unregistered hook + no user_metadata fallback = fail closed (all access denied). AD-7's negative test catches this pre-deployment.
- **AD-13 × AD-14:** Both hit Postgres per login (~3 round trips total). MVP-acceptable latency.
- **AD-2 × AD-3:** Asymmetry — staff use `user_id = auth.uid()` directly; customers use a separate `auth_user_id` column. This creates two different patterns:
  - Staff: `auth.uid()` → look up `users` → done (one hop)
  - Customer: `auth.uid()` → look up `customer_accounts` via `auth_user_id` → done (one hop, but different column name)
  - Sprint 6's customer RLS needs its own helper function (not reusable from `auth.consultant_project_ids()`)
  - **Critical Sprint 6 dependency:** the convert flow MUST populate `customer_accounts.auth_user_id` atomically with Auth user creation (same compensating-delete pattern as T2). If `auth_user_id` is NULL, T4's login query (`.eq('auth_user_id', auth_uid)`) won't match the row, and the customer gets `403 ACCOUNT_NOT_FOUND` despite having a valid account row linked by `lead_id`. This is the same partial-failure category as T2 — needs the same rigor.
- **AD-2 × AD-5:** RPC stores `p_manager_id` from the Edge Function's `rbac.auth.userId`, which equals `auth.uid()` (AD-2). Consistent only if all staff are created via T2. Protected by AD-15's invariant ("Auth users created outside T2 is an operational error").
- **AD-8 × AD-11:** Maintenance coupling — every new helper function needs a GRANT. Grows linearly with sprints. Documented in AD-11 trade-off.

**Updated after Sprint 2 (AD-19 interactions):**

- **AD-19 × AD-5:** Confirmed — `replace_project_spaces` has `SECURITY DEFINER` + `SET search_path = public`. Same discipline as `assign_lead_to_consultant`.
- **AD-19 × AD-11:** Confirmed — `GRANT EXECUTE TO authenticated, service_role` present on the function.
- **AD-19 × AD-18:** Bidirectional co-maintenance markers exist (migration → stage-4.ts, stage-4.ts → RPC). The RPC doesn't raise named exceptions like T7 — it relies on Postgres constraint errors. Edge Function matches on constraint names (`one_primary_wall_per_project`, `space_type_enum`).
- **AD-19 × FK constraints on `application_spaces`:** **Sprint 4 dependency found.** Six tables FK-reference `application_spaces.space_id`. The RPC's `DELETE FROM application_spaces WHERE project_id = X` will fail with a FK violation once Sprint 4 populates `space_configurations`, `space_measurements`, etc. Resolution deferred to Sprint 4: either (a) block Stage 4 resubmission once downstream data exists, or (b) add CASCADE or clear child tables in the RPC. This is NOT a Sprint 2 bug (no child rows exist in Sprint 2), but it's a real runtime error Sprint 4 must handle before going live.
- **AD-19 × Stage 4 resubmission:** Resubmission while still in Stage 4 phase is correct behavior per the spec ("saved incrementally," tablet-first UX). The lock comes from Sprint 4 (Stage 5 start freezes spaces). Atomicity (AD-19) makes resubmission safe from a data-integrity perspective within Sprint 2's scope.

**Updated after Sprint 3 (AD-20/AD-21 interactions):**

- **AD-20 × AD-5:** Confirmed — `approve_sku_proposal` has `SECURITY DEFINER` + `SET search_path = public` + `GRANT EXECUTE`. Full AD-5/AD-11 discipline.
- **AD-21 × AD-19:** Complementary, not contradictory. Decision tree: is intermediate state corrupt? Yes → RPC (AD-19). No → is failure visible? Yes → two calls (AD-21). These cover the full spectrum of multi-step writes.
- **AD-20 × AD-15:** Layered — AD-20 is defense-in-depth given AD-15's single-role-per-user invariant. If AD-15 ever breaks, AD-20 becomes real enforcement. No contradiction.
- **AD-21 × notifications:** AD-21's "visible" test assumes queue views exist as a discovery path independent of notifications. Holds as long as Admin checks queues (true in current architecture). Would fail if notifications became the only alert mechanism with no queue polling.
- **T5 FK forward-check:** `design_elements` and `template_consumables` confirmed as true leaf tables — no Sprint 4+ FK dependencies (unlike `application_spaces`). Configuration Engine reads-then-copies, doesn't FK-reference.

No contradictions found. No reversals needed.

**Sprint 4 Spec-Interpretation Fixture List:**
- SI-1: L_SHAPE `segment_b_mm = 0` or `null` → **CONFIRMED (Option A, AD-22).** Accepted as valid, resolved as straight geometry for calculations. wall_shape unchanged for audit.
- SI-2: PER_RFT_HEIGHT `/1000` vs `/304.8` → **CONFIRMED (/1000, AD-23).** Spec literal is authoritative. The naming inconsistency ("RFT" but produces meters) is documented, not fixed. Any change to `/304.8` requires a formal spec revision.
- SI-3: R5 "matching" — runtime search vs pre-linked lookup → **CONFIRMED (pre-linked + runtime validation, AD-24).** Engine reads template's TRIM design_elements (pre-selected by Designer), does NOT search product_library. Engine DOES validate colour/finish compatibility at runtime. "Matching" = validate the pre-link, not discover a new one.
- Test specs (T9) are AUTHORED (assertions documented) but NOT EXECUTED (no live infra in this sandbox, placeholder bodies only)
- "0 bugs found" means "0 bugs found via conversational Q&A + checklist" — NOT "0 bugs found by running tests"
- The checklist addresses STRUCTURAL correctness (grants, atomicity, FKs) — Sprint 4 needs COMPUTATIONAL correctness verification (golden fixtures, formula tests, hash determinism) which the current 7-category checklist does not cover
- Sprint 4 must define its own verification model BEFORE writing engine code

---

## Pending (Future Sprints)

_Decisions that are expected to be needed but haven't been made yet._

- **Sprint 3:** `payment_method_enum` — whether to add `NET_BANKING`/`EMI` (Part 15, item 7)
- **Sprint 4:** Stage 4 resubmission after downstream data exists — **RESOLVED in Sprint 4 T0:**
  `replace_project_spaces` RPC now checks for child rows before DELETE. If any
  space has `space_configurations`, `space_measurements`, `configured_furniture`, or
  `space_design_overrides` rows → `422 SPACES_LOCKED_BY_CONFIGURATION`. Stage 4
  is only re-submittable while spaces are "clean" (pre-Stage-5).
- **Sprint 6:** Customer RLS via `customer_accounts.auth_user_id` — exact policy shape
  depends on how customer project links are populated during the convert flow
- **Sprint 6:** Convert flow MUST use compensating-delete pattern for customer Auth +
  `customer_accounts.auth_user_id` population (same as T2's staff pattern). If Auth
  user is created but `auth_user_id` isn't set on the `customer_accounts` row, T4's
  login path returns `403 ACCOUNT_NOT_FOUND` with audit log entry — loud failure,
  but confusing to the customer. The convert flow must not leave this column NULL.
  T4 already handles this gracefully (distinct error code + audit log), but prevention
  is better than detection.
