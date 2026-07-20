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
| AD-25 | R8 arrays sorted by stable key before serialization (idempotency guarantee) | Without explicit sorting, two engine runs producing the same logical line items in different insertion order would produce different `configuration_hash` values — violating "same configuration → same hash." Sort keys: `line_items` by (sku, group_name, product_role); `furniture` by (sku, default_position). Proven by idempotency tests (two different insertion orders → same hash). | Sort adds negligible overhead. If new arrays are ever added to ConfigHashInput, they must also be sorted (AD-25 principle). | Yes |
| AD-26 | Engine-to-Edge-Function bridge uses esbuild bundling (Option E) — SI-4 CONFIRMED | The Configuration Engine (`packages/config-engine/`) is tested via vitest (145 tests). Edge Functions (Deno runtime) cannot import from local package paths. **Resolution:** `esbuild` bundles `packages/config-engine/src/rules/index.ts` → `supabase/functions/api-consultation/engine-bundle.js` (single 13.9kb ESM file). The bundle IS the compiled tested source — not a copy, not a rewrite. **Proven:** bundle produces the exact same frozen hash as the source (`f8156a7e...` matches). **Rejected:** (A) duplicate logic (two copies drift), (B) publish to registry (external dependency for MVP), (C) Postgres functions (loses TypeScript testability), (D) separate Edge Function (extra network hop). **CI enforcement:** `npm run verify:engine-bundle` regenerates and fails if committed bundle differs from source. `npm run predeploy:functions` rebuilds before every deploy. Bundle IS committed to repo (not gitignored) — considered gitignoring and regenerating at deploy time, rejected because it doesn't fail loudly for a local/direct deploy path where someone skips the build step. Committed + CI-verify gives both "always deployable" and "always current." | Requires esbuild as a dev dependency. Bundle must be regenerated when `packages/config-engine/src/` changes. `verify:engine-bundle` script catches stale bundles in CI. | Yes |
| AD-27 | All user-defined functions must be in `public` schema (not `auth`) on hosted Supabase — auth hook specifically must NOT use SECURITY DEFINER | **What broke:** Migration 00006 created helper functions in `auth.` schema; migration 00007 created the access token hook in `auth.` schema. Both failed with `permission denied for schema auth` on hosted Supabase. **Root cause:** The `auth` schema is managed by Supabase's Auth service and is read-only to project migrations. This constraint is not discoverable without a live hosted project (local dev with `supabase start` has broader permissions). **Fix:** All functions moved to `public` schema, following Supabase's documented pattern. **Critical subtlety for the auth hook specifically:** Supabase docs explicitly recommend AGAINST `SECURITY DEFINER` on hook functions: "For security, we recommend against the use the security definer tag." This contradicts AD-5's pattern (which correctly applies to all OTHER RPCs). The hook function should NOT have `SECURITY DEFINER` — instead, it runs as invoker (`supabase_auth_admin`) with explicit grants. **Grants required:** `GRANT USAGE ON SCHEMA public TO supabase_auth_admin; GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin; GRANT SELECT ON TABLE public.users TO supabase_auth_admin; REVOKE EXECUTE ... FROM authenticated, anon, public;` **What this means for the repo:** Migration files 00006 and 00007 in the repo must be updated to use `public.` schema references. The original files remain in git history as the pre-discovery versions; the current HEAD files reflect the hosted-compatible versions. AD-27 documents why they differ from what was originally reviewed. **DO NOT "fix" the hook back to SECURITY DEFINER** — it contradicts Supabase's documented security model for hooks specifically, even though every other RPC correctly uses it. | Functions in `public` schema are accessible via Supabase's REST API unless explicitly revoked (`REVOKE EXECUTE FROM authenticated, anon, public`). The hook function has this revocation. Helper functions (user_role, etc.) are intentionally accessible to authenticated users (they're called by RLS policies). | Yes |

---

## Sprint 5 Decisions

| ID | Decision | Rationale | Trade-off | Frozen? |
|---|---|---|---|---|
| AD-28 | Quotation seal uses plain SHA-256, independently auditable (not HMAC) | Primary purpose is auditability and reproducibility. `sha256_hash = SHA256(canonical_json(seal_payload))` must be independently recomputable from stored data alone, without the live engine or any secret material. | Does NOT prevent forgery by someone with DB write access (they could edit both seal_payload and sha256_hash consistently). Tamper-evidence against privileged insiders would require HMAC or digital signatures — deliberately Layer 2. | Yes |
| AD-29 | Quotation engine Steps 4-5 use `unit_cost_paise` (not `sell_price_paise`) — SI-5 CONFIRMED | **What triggered the question:** `product_library` stores both columns with real, independently-set values (`WLP-WPC-CLS-OAK-001`: cost=32000, sell=42000 → 31.25% markup, NOT 25%). If sell prices were derived from cost+25%, they'd be uniform — they're not. Part 8 Step 4 literally says `×unit_cost`. **Confirmed by Akshay:** Steps 4-5 use `unit_cost_paise`. Step 12's `ROUND(subtotal×0.25)` is the margin that transforms cost into customer-facing price. `sell_price_paise` is NOT consumed by the formal quotation engine — it's available for Admin reference and potentially the price-preview approximation (T10, separate question). **Consequence for the regression fixture (Space 1, 18 panels):** `18 × 32000 = 576,000` (not `18 × 42000 = 756,000`). A 31% difference in the quoted panel line. | `sell_price_paise` column exists but is confirmed as NOT authoritative for the sealed quotation. Its purpose is reference/preview, not formal pricing. A future T10 implementation may use it for quick display. | Yes |
| AD-30 | Rounding is `Math.round()` (standard half-up, nearest paise) — SI-7/8 CONFIRMED | **What triggered the question:** Steps 12-13 both say `ROUND(...)` without specifying precision or direction. Indian GST calculations sometimes have mandated rounding rules. Banker's rounding is common in financial systems. **Confirmed by Akshay:** Standard `Math.round()` (half-up), to nearest paise, no special GST-compliance rule for MVP. Rounding happens at each `ROUND()` step as literally written in Part 8 (Step 12 rounds the margin result, Step 13 rounds the GST result). | Not GST-compliant if regulations require a specific rounding convention. Acceptable for MVP. If compliance requirements surface later, this is a one-line change (swap `Math.round` for the mandated function) + re-baseline regression values. | Yes |
| AD-31 | Per-line-item cost rounded to integer paise before summing (platform rule enforcement) | **What triggered the question:** Trim quantity is fractional (41.338... rft × 4800 = 198,425.19... paise). Without per-line rounding, `subtotal_paise` was 3,329,243.307 — a fractional paise value stored in a BIGINT column. **Platform rule (Part 1, non-negotiable):** "Money in paise (BIGINT) — never floating point." This means every money intermediate must be integer. **Resolution:** `Math.round(quantity × unit_cost_paise)` applied per line item at Steps 4, 5, and 8. This ensures all intermediates (trim_total, subtotal, pre_gst, grand_total) are integer by construction. Steps 12/13 still round explicitly (margin, GST), but pre_gst and grand_total are naturally integer (sum of integers) — no extra round needed. **Impact on regression baseline:** grand_total changed from 4,910,634 (float-carry) to 4,910,635 (per-line integer). A 1-paise difference caused by rounding 3 trim costs individually vs carrying full precision. **NOT an SI item:** The platform rule is explicit and non-negotiable. The only question was where to apply it, and the answer is: at every point where `quantity × cost` produces a money value. | Per-line rounding accumulates differently than end-rounding (can differ by up to N×0.5 paise where N = number of fractional-qty line items). This is the standard accounting approach (round each line on the invoice). | Yes |

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
- SI-4: Engine-to-Edge-Function bridge → **CONFIRMED (Option E: esbuild bundle, AD-26).** Tested source compiled into single ESM file via esbuild. Bundle produces identical frozen hash. Committed to repo, CI verifies staleness.

**Sprint 4 Boundary-Fidelity Proof (T9, executed against live Supabase):**

Evidence: persist_configuration RPC called via MCP against project `demfvizmxkuxvluopmtq` (Postgres 17, ap-south-1).

What was PROVEN:
- Engine hash = DB stored hash = frozen Gate 1 baseline (`f8156a7e...`) ✅
- Trim quantity stored as `41.338582677165356` (full precision, NUMERIC column with no scale limit) ✅
- Column type verified: `data_type = 'numeric'`, `numeric_precision = null`, `numeric_scale = null` (arbitrary precision) ✅
- The automated engine→RPC path preserves full floating-point precision ✅

What the FIRST FAILURE taught (precision important):
- Manual SQL call with truncated qty `41.3386` → produced DIFFERENT hash on rehash
- This validates the test's sensitivity: it DETECTS precision loss
- The bug was in the TEST SETUP (hand-typed value), NOT in the production code path
- The production path (engine output → JSON → RPC → DECIMAL) was never broken

What this does NOT prove (remaining gaps):
- Full 36-table migration suite has never been applied end-to-end to this project
  (only 5 tables + 1 RPC were created for this specific test)
- Sprint 1–3 RLS policies, RPCs (assign_lead, approve_sku), and guard endpoints
  have not been executed against live infrastructure
- Stage 7's actual Edge Function import of engine-bundle.js in Deno runtime untested
  (the proof uses Node.js bundle execution, not Deno Edge Function execution)
- Concurrency (one_current_config_per_space under parallel requests) not load-tested

Recommended next steps (before Sprint 5):
- Apply full migration suite (00001–00013) to the live project
- Execute Sprint 1–3 RPC tests (assign_lead_to_consultant, approve_sku_proposal) against live DB
- Deploy an Edge Function using engine-bundle.js and verify Deno runtime executes correctly
- Test specs (T9) are AUTHORED (assertions documented) but NOT EXECUTED (no live infra in this sandbox, placeholder bodies only)
- "0 bugs found" means "0 bugs found via conversational Q&A + checklist" — NOT "0 bugs found by running tests"
- The checklist addresses STRUCTURAL correctness (grants, atomicity, FKs) — Sprint 4 needs COMPUTATIONAL correctness verification (golden fixtures, formula tests, hash determinism) which the current 7-category checklist does not cover
- Sprint 4 must define its own verification model BEFORE writing engine code

---

## Pending (Future Sprints)

_Decisions that are expected to be needed but haven't been made yet._

- **Sprint 5 (T10):** Price-preview endpoint — does it use `sell_price_paise` directly
  for quick Consultant display, or `unit_cost_paise + margin` like the formal sealed
  quotation engine? Context: AD-29 confirmed the *formal* 13-step engine uses
  `unit_cost_paise`. But `sell_price_paise` exists as a per-SKU Admin-set value that
  could serve as a fast approximate preview without running the full engine. The two
  approaches produce different numbers (e.g., panel: cost×qty = 576,000 vs sell×qty =
  756,000 for the Space 1 fixture). **Status:** Flagged to Akshay as a fast yes/no.
  Not blocking T1–T9; only blocks T10 implementation. If Akshay answers "use
  sell_price_paise directly," T10 is trivial (sum from configuration_line_items). If
  "use cost+margin," T10 must replicate Steps 4-5+11+12+13 or call the engine.
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
