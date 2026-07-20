# Verification Sprint — End-to-End Infrastructure Validation

**Executed:** 2026-07-20  
**Target:** Supabase project `demfvizmxkuxvluopmtq` (ap-south-1, Postgres 17)  
**Purpose:** Validate all Sprints 1–5 work end-to-end against live infrastructure before Sprint 6.

---

## Results Summary

| Check | Status | Key Evidence |
|---|---|---|
| V1: Migrations consistent | ✅ PASSED | 10 RPCs, 37 tables, 39 enums, all RLS enabled |
| V2: Sprint 1 RPCs | ✅ PASSED | assign_lead_to_consultant happy path + 3 guards |
| V3: Sprint 2-3 RPCs | ✅ PASSED | replace_project_spaces + approve_sku_proposal (5 guards total) |
| V4: RLS helper functions | ✅ PASSED | 5 functions, STABLE+SECDEF, grants confirmed, policies correct |
| V5: Sprint 4 persist_config | ✅ PASSED | Bundle not stale, RPC works, archive R9 verified, decimal precision |
| V6: Sprint 5 full chain | ✅ PASSED | Real data: config RPC → review gate → quotation → seal → verify |

**Overall: ALL 6 VERIFICATION CHECKS PASSED. No blocking gaps found.**

---

## V1: Migration Consistency

- **37 tables** present in `public` schema (all with RLS enabled)
- **39 enums** (per AD-10)
- **10 RPCs** with correct SECURITY DEFINER settings:
  - `custom_access_token_hook`: NOT SECURITY DEFINER (per AD-27, hooks only)
  - All others: SECURITY DEFINER + SET search_path = public
- **30 migration versions** in `supabase_migrations` (includes superseded early attempts;
  final state is correct)

## V2: Sprint 1 RPCs

### assign_lead_to_consultant
- Happy path: NEW→ASSIGNED, `lead_activities` row, `notifications` row ✅
- Guard: `LEAD_NOT_FOUND` (non-existent lead) ✅
- Guard: `CONSULTANT_NOT_FOUND` (non-existent user) ✅
- Guard: `LEAD_ALREADY_ASSIGNED` (double-assign attempt) ✅

### Other Sprint 1 artifacts
- `login_attempts` table: accepts inserts (id, ip_address, email, attempted_at) ✅
- `custom_access_token_hook`: correct signature (event jsonb → jsonb), public schema ✅

## V3: Sprint 2-3 RPCs

### replace_project_spaces (Sprint 2, AD-19)
- Happy path: atomic delete+insert (2 old spaces → 3 new) ✅
- Guard: `SPACES_LOCKED_BY_CONFIGURATION` — blocks when downstream configs exist ✅

### approve_sku_proposal (Sprint 3, AD-20)
- Happy path: PROPOSED→ACTIVE with pricing (28000/36400) ✅
- Guard: `SELF_APPROVAL_NOT_ALLOWED` (AD-20 defense-in-depth) ✅
- Guard: `SKU_NOT_PROPOSED` (already ACTIVE) ✅
- Guard: `SKU_NOT_FOUND` (non-existent) ✅
- Guard: `INVALID_PRICING` (zero cost) ✅

## V4: RLS Helper Functions

| Function | SECDEF | STABLE | GRANT auth | GRANT service_role |
|---|---|---|---|---|
| user_role | ✅ | ✅ | ✅ | ✅ |
| user_id | ✅ | ✅ | ✅ | ✅ |
| consultant_project_ids | ✅ | ✅ | ✅ | ✅ |
| manager_project_ids | ✅ | ✅ | ✅ | ✅ |
| staff_project_ids | ✅ | ✅ | ✅ | ✅ |

- Underlying SQL logic verified: `consultant_project_ids` returns correct 6 projects for test user
- RLS policies on projects, leads, application_spaces, configuration_line_items,
  quotation_snapshots all use the correct helper functions

## V5: Sprint 4 Configuration Engine

- **Engine bundle**: `verify:engine-bundle` passes (no diff between source and committed bundle) ✅
- **persist_configuration RPC**:
  - Happy path: FRAME_BASED config + 2 line items persisted ✅
  - Decimal precision: trim qty=38.5 stored as full NUMERIC ✅
  - Archive (R9): old config → is_current=FALSE, new → is_current=TRUE ✅
  - Constraint: only one is_current=TRUE per space at any time ✅
- **145 config-engine tests**: all passing, frozen hashes unchanged ✅

## V6: Sprint 5 Full Chain (Real Data Flow)

This is the critical test — real data flowing through Sprint 4's persistence into Sprint 5's
quotation engine, not pre-constructed fixtures.

**Flow executed:**
1. Created fresh project (f6000000-...-0100) with lead + space + photo + budget
2. Called `persist_configuration` (Sprint 4 RPC) → 3 real line items stored
3. Called `submit_review_gate` → PASS (all 7 items, checked REAL config data)
4. Read back line items from DB (originated from Sprint 4 RPC)
5. Computed quotation engine: `grand_total = 2,032,886 paise` (₹20,328.86)
6. Computed seal: `4985728df8576c92870594146b53743cf4a67f1b7bec3274c9d40e08267bc2a7`
7. Called `persist_quotation_snapshot` → snapshot + 3 bom_lines + expires_at
8. Read back `seal_payload` (JSONB, keys reordered by Postgres)
9. Re-canonicalized → SHA-256 → **MATCH** ✅

**This proves:** The complete Sprint 4 → Sprint 5 data pipeline works with real
persistence — not just unit tests exercising pure functions in isolation.

---

## Known Remaining Gaps (explicitly documented, not blocking Sprint 6)

1. ~~**RLS enforcement under real JWT**~~: **CLOSED in two parts (V7a + V7b).**

   **V7a — Policy enforcement (proven):** Tested via `SET LOCAL ROLE authenticated` with
   `request.jwt.claims` set to simulate real JWT context. Consultant B (non-owner)
   sees **0 rows** across projects, leads, configuration_line_items, quotation_snapshots.
   Consultant A (owner) sees only their own data. ADMIN sees everything. This proves:
   *if a JWT with the correct claim shape arrives, RLS correctly isolates by tenant.*

   **V7b — Hook claim generation (proven):** `custom_access_token_hook` invoked directly
   with synthetic Supabase Auth event payloads. Verified it produces:
   - SALESPERSON → `app_metadata.role = "SALESPERSON"`, `app_metadata.user_status = "ACTIVE"`
   - ADMIN → `app_metadata.role = "ADMIN"`, `app_metadata.user_status = "ACTIVE"`
   - Unknown user (not in public.users) → `app_metadata.role = "CUSTOMER"`
   This proves: *the hook produces the exact claim shape that RLS policies read from.*

   **Claim shape alignment confirmed:** Hook writes to `claims.app_metadata.role`;
   `user_role()` reads from `auth.jwt() -> 'app_metadata' ->> 'role'`; V7a test
   injected claims at the same path. All three reference the same JSONB location.

   **What remains untested (honest scope boundary):** The one layer NOT exercised
   is Supabase Auth's internal mechanism for *calling* the hook during token issuance.
   Specifically: whether the hook is correctly *registered* in the hosted project's Auth
   configuration (Dashboard → Auth → Hooks) such that it's actually invoked on every
   `signInWithPassword()` call. This is a platform-configuration concern (one checkbox
   in the Supabase dashboard), not a code-correctness concern — the hook's logic is
   proven correct, and the policy enforcement is proven correct, but the wiring between
   "Supabase Auth issues a token" and "this hook function gets called" depends on a
   dashboard configuration step that cannot be verified from this sandbox. This is
   the same category as "is the Edge Function actually deployed?" — infrastructure
   wiring, not code logic.

2. **Deno Edge Function runtime**: The `api-quotation`, `api-review`, and
   `api-consultation` Edge Functions have not been DEPLOYED and called via HTTP.
   Their logic has been proven via direct RPC calls (the RPCs they orchestrate all
   work correctly), but the Deno runtime layer (import resolution, JWT validation
   in the middleware, HTTP routing) is untested against the actual Edge Function
   deployment mechanism. This requires `supabase functions deploy` + an HTTP client
   with a real JWT — not available in this sandbox.

3. **Concurrency**: No concurrent-request testing was performed. The partial unique
   index `one_current_config_per_space` and the `FOR UPDATE` row locks in RPCs are
   structurally present, but haven't been exercised under parallel load.

**Assessment:** None of these gaps represent code defects or missing features.
They are infrastructure-testing limitations that would be resolved by:
- A CI environment with Docker (for full supabase start)
- Or: first production deployment + smoke test suite with real auth tokens

---

## Test Counts (as of verification sprint)

- Configuration engine: **145 tests** (11 test files)
- Quotation engine: **33 tests** (2 test files)
- Total automated: **178 passing**
- Live RPC verifications: **V1–V6** (this document)
