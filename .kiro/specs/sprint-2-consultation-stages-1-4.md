# Sprint 2 — Consultation, Stages 1–4

## Sprint 1 Dependencies (explicit handoff)

This sprint builds on these Sprint 1 primitives — if any of these change,
Sprint 2 code must be reviewed against the change:

| Sprint 1 Artifact | What Sprint 2 uses it for | Location |
|---|---|---|
| `requireAuth()` middleware | RBAC on all consultation endpoints (SALESPERSON, own-project checks) | `_shared/middleware/rbac.ts` |
| `auth.consultant_project_ids()` RLS helper | Consultant sees only own projects/spaces | `00006_create_rls_policies.sql` |
| `projects` table + `PROJECT_CREATED` status | Created by T9's CONVERTED transition — Sprint 2 starts here | `00002_create_tables_domains_1_4.sql` |
| `consultation_stages` table | Stage-tracking rows (UNIQUE project_id + stage_number) | `00002_create_tables_domains_1_4.sql` |
| Response envelope (`success`/`error`/`paginated`) | All endpoint responses | `_shared/response.ts` |
| AD-2 (users.user_id = Auth UID) | Ownership check: `projects.consultant_id = auth.uid()` | `DECISIONS.md` |
| AD-5 (SECURITY DEFINER + search_path) | Pattern for any new RPC functions this sprint | `DECISIONS.md` |
| AD-8 (STABLE helper functions) | Any new RLS policies must use helper functions, not inline subqueries | `DECISIONS.md` |
| AD-11 (GRANT EXECUTE on helpers) | Any new helper functions need explicit grants | `DECISIONS.md` |
| AD-18 (co-maintenance markers) | Any new RPC exception sites need the same pattern | `DECISIONS.md` |
| `one_primary_wall_per_project` partial unique index | DB-enforced max-one-primary (already in 00005) | `00005_create_indexes.sql` |
| `application_spaces` table | Already exists with `is_primary_wall` column | `00003_create_tables_domains_5_8.sql` |
| `getAdminClient()` / `getUserClient()` | DB access patterns | `_shared/supabase.ts` |
| Crypto module (`encryptMobile`, `hashMobile`) | Not directly used in Sprint 2, but sets the pattern for any future encryption needs | `_shared/crypto.ts` |

---

## Requirements

Source: Engineering Handover v7.0, Part 4 (WF-3, Stages 1–4), Part 5 (Domains 3–4),
Part 7 (Consultation endpoints), Part 10 (Gate 4, Gate 6), Part 13 (Sprint 2 definition).

### R1: Project Creation on Lead Conversion (handoff from Sprint 1 T9)
- When a lead transitions to `CONVERTED`, Sprint 1's T9 already creates a `projects`
  row with `status = PROJECT_CREATED`
- Sprint 2 starts from this state — no separate "create project" endpoint needed
- Sprint 2's first action: Consultant opens the project → `status → CONFIGURING`,
  7 `consultation_stages` rows created (one per stage, all `PENDING`)

### R2: Stage 1 — Customer Profile (Welcome & Registration)
- `PUT /api/v1/projects/:id/consultation/stage/1` — owning Consultant only
- Saves: customer_name, mobile, email, address, project_type
- Updates `projects` table fields (customer_name, project_address, city already
  exist from lead conversion — this stage allows refinement/correction)
- Stage 1 completion: all required fields populated
- **Guard (Gate 4, Sprint 1 deferred):** `403 LEAD_NOT_ASSIGNED_TO_YOU` if
  `projects.consultant_id ≠ auth.uid()` — this is the Sprint 1 placeholder
  test now implemented for real

### R3: Stage 2 — Lifestyle Assessment
- `PUT /api/v1/projects/:id/consultation/stage/2` — owning Consultant
- Saves to `lifestyle_assessments` table (1:1 with project, UPSERT):
  family_member_count, has_children, has_senior_citizens, has_pets,
  work_from_home, storage_need, maintenance_expectation, preferred_style_notes
- No blocking guards beyond ownership

### R4: Stage 3 — Budget Planning
- `PUT /api/v1/projects/:id/consultation/stage/3` — owning Consultant
- Saves to `budget_profiles` table (1:1 with project, UPSERT):
  budget_tier (STANDARD/PREMIUM/LUXURY), priority_spaces, interest_in_upgrades
- **Locks `budget_tier` for the session** — once set via this endpoint, subsequent
  calls can update other fields but cannot change `budget_tier` (Part 4 Stage 3:
  "Locks the price band for the session")
- Budget tier displayed as Elegant/Premium/Luxury in UI (display-label mapping only)

### R5: Stage 4 — Space Selection
- `PUT /api/v1/projects/:id/consultation/stage/4` — owning Consultant
- Creates/updates `application_spaces` rows (up to 5 per project):
  space_type, wall_shape, primary_parameter_value, planning_notes, is_primary_wall
- Body: `{ spaces: [{space_type, wall_shape, is_primary_wall, ...}] }` — full
  replacement semantics (all spaces for this project submitted at once)
- **Partial unique index guard:** `one_primary_wall_per_project` prevents multiple
  `is_primary_wall = TRUE` rows per project (DB-enforced)
- **App-layer guards:**
  - `422 PRIMARY_WALL_REQUIRED`: at least one space must have `is_primary_wall = TRUE`
  - `422 SECONDARY_LIMIT_EXCEEDED`: max 5 spaces total (1 primary + ≤4 secondary)
  - `422 INVALID_SPACE_TYPE`: reject the 7 invalid space types from Part 3
    (TV_WALL, BEDROOM_WALL, WARDROBE, KITCHEN, POOJA_WALL, STAIRCASE_WALL, BALCONY_WALL)
- Rough L×H can be provided for filtering only — NOT the engine-triggering measurement
  (that's Stage 7, Sprint 4)

### R6: Consultation Progress Tracking
- `GET /api/v1/projects/:id/consultation/progress` — owning Consultant
- Returns stage-by-stage completion state (7 rows from `consultation_stages`)
- Each stage: `{stage_number, status (PENDING/IN_PROGRESS/COMPLETED), completed_at}`
- Stage completion logic:
  - Stage 1: all required customer profile fields non-null
  - Stage 2: `lifestyle_assessments` row exists for this project
  - Stage 3: `budget_profiles` row exists with `budget_tier` set
  - Stage 4: ≥1 space exists with `is_primary_wall = TRUE`
  - Stages 5–7: Sprint 4 (not evaluated yet, always show PENDING)

### R7: Stage Sequencing
- Stages are stage-sequential (Part 4): Stage N cannot be submitted until Stage N-1
  is COMPLETED (except Stage 1, which is always accessible)
- `422 PREVIOUS_STAGE_INCOMPLETE`: returned if attempting to submit Stage N while
  Stage N-1 is still PENDING or IN_PROGRESS
- On first Stage 1 submission: project status transitions `PROJECT_CREATED → CONFIGURING`
  (one-time, idempotent on subsequent Stage 1 edits)

### R8: Space Type Validation
- The 12 valid `space_type_enum` values are enforced at the DB level (enum type)
- The 7 *invalid* legacy values (TV_WALL, BEDROOM_WALL, WARDROBE, KITCHEN,
  POOJA_WALL, STAIRCASE_WALL, BALCONY_WALL) are rejected at the app layer with
  `422 INVALID_SPACE_TYPE` — they're not in the enum, so DB would also reject them,
  but the app layer provides a friendlier error message

### R9: Design DNA (project-level preferences)
- `PUT /api/v1/projects/:id/design-dna` — owning Consultant
- Saves to `design_dna` table (1:1 with project, UPSERT):
  design_style, colour_palette, material_preference, finish_preference,
  lighting_preference
- Used by the Recommendation Engine (Sprint 4) — Sprint 2 just captures the data
- Not stage-gated (can be filled at any point during consultation)

---

## Design

### Consultation Stage Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Project (status: CONFIGURING)                            │
│                                                          │
│  consultation_stages (7 rows, one per stage):            │
│  ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┐          │
│  │ S1  │ S2  │ S3  │ S4  │ S5  │ S6  │ S7  │          │
│  │COMP │COMP │ IP  │PEND │PEND │PEND │PEND │          │
│  └─────┴─────┴─────┴─────┴─────┴─────┴─────┘          │
│                                                          │
│  Related data (1:1 with project):                        │
│  ├── lifestyle_assessments  (Stage 2)                    │
│  ├── budget_profiles        (Stage 3)                    │
│  ├── design_dna             (any time)                   │
│  └── application_spaces[]   (Stage 4, up to 5)          │
│       └── is_primary_wall   (exactly 1 must be TRUE)     │
└─────────────────────────────────────────────────────────┘
```

### Endpoint Routing

All consultation endpoints share one Edge Function (`api-consultation`) with
internal routing by stage number:

```
supabase/functions/
├── api-consultation/
│   ├── index.ts          # Router: dispatches to stage handlers
│   ├── progress.ts       # GET /projects/:id/consultation/progress
│   ├── stage-1.ts        # PUT .../stage/1 — Customer Profile
│   ├── stage-2.ts        # PUT .../stage/2 — Lifestyle Assessment
│   ├── stage-3.ts        # PUT .../stage/3 — Budget Planning
│   └── stage-4.ts        # PUT .../stage/4 — Space Selection
├── api-design-dna/
│   └── index.ts          # PUT /projects/:id/design-dna
```

### Stage Sequencing Enforcement

```typescript
// Shared sequencing guard (called by each stage handler before processing)
async function requirePreviousStageComplete(
  admin: SupabaseClient,
  projectId: string,
  targetStage: number
): Promise<Response | null> {
  if (targetStage <= 1) return null; // Stage 1 always accessible

  const { data: prevStage } = await admin
    .from('consultation_stages')
    .select('status')
    .eq('project_id', projectId)
    .eq('stage_number', targetStage - 1)
    .single();

  if (!prevStage || prevStage.status !== 'COMPLETED') {
    return error(
      'PREVIOUS_STAGE_INCOMPLETE',
      `Stage ${targetStage - 1} must be completed before Stage ${targetStage}`,
      422
    );
  }
  return null; // Proceed
}
```

### Space Selection — Primary Wall Enforcement

Three-layer enforcement (belt, suspenders, and the DB):

1. **App layer (api-consultation/stage-4.ts):**
   - Validates exactly 1 space has `is_primary_wall = TRUE` → else `422 PRIMARY_WALL_REQUIRED`
   - Validates total spaces ≤ 5 → else `422 SECONDARY_LIMIT_EXCEEDED`
   - Validates space types against invalid list → else `422 INVALID_SPACE_TYPE`

2. **DB partial unique index (`one_primary_wall_per_project`):**
   - Prevents >1 primary even if app layer is bypassed (concurrent requests, etc.)
   - Already exists in migration 00005

3. **Stage completion check (`consultation_stages.status`):**
   - Stage 4 is not marked COMPLETED unless ≥1 space has `is_primary_wall = TRUE`
   - This blocks progression to Stage 5 (Sprint 4)

### Budget Tier Lock

```typescript
// In stage-3.ts:
// If budget_tier already set, reject attempts to change it
if (existingProfile && existingProfile.budget_tier && body.budget_tier !== existingProfile.budget_tier) {
  return error(
    'BUDGET_TIER_LOCKED',
    'Budget tier cannot be changed once set. Current tier: ' + existingProfile.budget_tier,
    422,
    'budget_tier'
  );
}
```

---

## Tasks

### T1: Consultation Stage Initialization
- [ ] When project first accessed for consultation (Stage 1 first submission):
  - Create 7 `consultation_stages` rows (stage_number 1–7, status='PENDING')
  - Transition project status: `PROJECT_CREATED → CONFIGURING`
  - Write `project_state_history` row for the transition
- [ ] Idempotent: if stages already exist, skip creation
- [ ] Test: second call to Stage 1 doesn't duplicate stage rows

### T2: Stage 1 — Customer Profile
- [ ] Create `api-consultation/stage-1.ts`:
  - Validates ownership (`consultant_id = auth.uid()`) → `403 LEAD_NOT_ASSIGNED_TO_YOU`
  - Updates `projects` fields (customer_name, project_address, city, project_type)
  - Marks `consultation_stages` row for stage 1 as `COMPLETED`
- [ ] Gate 4 test (Sprint 1 deferred, now implemented):
  - Consultant A cannot submit Stage 1 on Consultant B's project → 403
- [ ] Test: Stage 1 completion with all fields populated

### T3: Stage 2 — Lifestyle Assessment
- [ ] Create `api-consultation/stage-2.ts`:
  - Requires Stage 1 complete (`422 PREVIOUS_STAGE_INCOMPLETE`)
  - UPSERT into `lifestyle_assessments`
  - Marks stage 2 as `COMPLETED`
- [ ] Test: Stage 2 blocked before Stage 1 completion
- [ ] Test: UPSERT (second call updates, doesn't duplicate)

### T4: Stage 3 — Budget Planning
- [ ] Create `api-consultation/stage-3.ts`:
  - Requires Stage 2 complete
  - UPSERT into `budget_profiles`
  - Budget tier lock: once set, cannot be changed (`422 BUDGET_TIER_LOCKED`)
  - Marks stage 3 as `COMPLETED`
- [ ] Test: budget_tier rejection on change attempt
- [ ] Test: other fields (priority_spaces, interest_in_upgrades) still updatable after lock

### T5: Stage 4 — Space Selection
- [ ] Create `api-consultation/stage-4.ts`:
  - Requires Stage 3 complete
  - Body: `{ spaces: [...] }` — full replacement semantics
  - Validates: exactly 1 primary, max 5 total, valid space types
  - Deletes old spaces for this project, inserts new ones (transaction)
  - Marks stage 4 as `COMPLETED` only if ≥1 primary wall exists
- [ ] Guards:
  - `422 PRIMARY_WALL_REQUIRED` (zero primary walls)
  - `422 SECONDARY_LIMIT_EXCEEDED` (>5 spaces)
  - `422 INVALID_SPACE_TYPE` (7 invalid legacy types)
- [ ] Test: DB partial unique index rejects >1 primary (concurrent path)
- [ ] Test: each of the 3 guards fires independently

### T6: Consultation Progress Endpoint
- [ ] Create `api-consultation/progress.ts`:
  - Returns 7 stage rows with computed completion status
  - Stages 5–7 always return PENDING (Sprint 4)
- [ ] Test: progress reflects actual stage completion state

### T7: Design DNA Endpoint
- [ ] Create `api-design-dna/index.ts`:
  - `PUT /api/v1/projects/:id/design-dna` — owning Consultant
  - UPSERT into `design_dna`
  - Not stage-gated
- [ ] Test: captures all 5 enum fields, validates enum values

### T8: Stage Sequencing Shared Utility
- [ ] Create `api-consultation/sequencing.ts`:
  - `requirePreviousStageComplete(admin, projectId, targetStage)` guard
  - Used by all stage handlers (T2–T5)
- [ ] Test: attempting Stage 3 before Stage 2 → 422

### T9: Gate Tests
- [ ] Gate 4 (Assignment Integrity, Sprint 2 portion):
  - Consultant A cannot access any consultation endpoint for Consultant B's project
  - `403 LEAD_NOT_ASSIGNED_TO_YOU` on all stage PUT endpoints
- [ ] Gate 6 (State Transition, Sprint 2 portion):
  - `PROJECT_CREATED → CONFIGURING` on first stage submission
  - `CONFIGURING` does not advance further in Sprint 2 (REVIEWED needs Sprint 5)
  - Lead transition tests from Sprint 1 still pass (regression)
- [ ] Primary wall tests:
  - Zero primary → 422
  - Two primary (concurrent) → DB rejects second
  - Exactly one primary → success
  - 6 spaces → 422 SECONDARY_LIMIT_EXCEEDED
  - Invalid space type → 422 INVALID_SPACE_TYPE

---

## Done Criteria (from Part 13)

> *Done when:* an assigned Consultant runs Stages 1–4, ends with exactly one
> primary + up to 4 secondary spaces, both guards tested.

Specifically:
1. ✅ Consultant opens a CONVERTED project → status transitions to CONFIGURING
2. ✅ Stage 1 saves customer profile (with ownership guard)
3. ✅ Stage 2 saves lifestyle assessment (requires Stage 1 complete)
4. ✅ Stage 3 saves budget profile with tier lock
5. ✅ Stage 4 saves spaces with primary-wall enforcement
6. ✅ Progress endpoint reflects stage completion accurately
7. ✅ `422 PRIMARY_WALL_REQUIRED` fires with zero primary walls
8. ✅ `422 SECONDARY_LIMIT_EXCEEDED` fires with >5 spaces
9. ✅ Gate 4: Consultant B cannot touch Consultant A's project
10. ✅ Gate 6: `PROJECT_CREATED → CONFIGURING` transition works, illegal jumps fail
