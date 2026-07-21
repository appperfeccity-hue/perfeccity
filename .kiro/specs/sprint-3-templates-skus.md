# Sprint 3 — SKU Master and Design Template Library

## Sprint 1–2 Dependencies (explicit handoff)

| Artifact | What Sprint 3 uses it for | Location |
|---|---|---|
| `requireAuth()` middleware | RBAC on all endpoints (ADMIN, DESIGNER roles) | `_shared/middleware/rbac.ts` |
| `product_library` table | SKU CRUD + propose/approve/reject | `00003_create_tables_domains_5_8.sql` |
| `design_templates` + `design_elements` + `template_consumables` + `digital_assets` | Template lifecycle | `00003_create_tables_domains_5_8.sql` |
| `notifications` table + `notification_type_enum` | `SKU_REJECTED`, `TEMPLATE_SUBMITTED_FOR_REVIEW`, `TEMPLATE_CHANGES_REQUESTED` | `00004`, `00001` |
| Response envelope + error patterns | All endpoints | `_shared/response.ts` |
| AD-5 (SECURITY DEFINER + search_path) | Any new RPC functions | `DECISIONS.md` |
| AD-11 (GRANT EXECUTE) | Any new helper functions or RPCs | `DECISIONS.md` |
| AD-18 (co-maintenance markers) | Any new exception-matching patterns | `DECISIONS.md` |
| Pre-write checklist | Applied BEFORE code generation this sprint | `.kiro/steering/pre-write-checklist.md` |
| Seed data (3 PUBLISHED templates, 24 SKUs) | Testing against existing data | `supabase/seed/seed.sql` |

---

## Requirements

Source: Engineering Handover v7.0, Part 3 (Product Architecture), Part 4 (WF-10, WF-11),
Part 5 (Domains 6–7), Part 7 (SKU Master + Design Library endpoints),
Part 9.4 (Designer UI), Part 13 (Sprint 3 definition).

### R1: SKU Master — Admin Direct CRUD
- `POST /api/v1/skus` — Admin creates SKU, `status = ACTIVE` immediately
- `PATCH /api/v1/skus/:sku` — Admin edits any field except `sku` (natural key, immutable)
- `POST /api/v1/skus/:sku/deactivate` — Admin sets `ACTIVE → INACTIVE`
  - `409 SKU_IN_USE` if referenced by a `PUBLISHED` template's `design_elements`
- `GET /api/v1/skus` — all staff, filterable by `category`, `status`
- `GET /api/v1/skus/export` — Admin, CSV download
- `POST /api/v1/skus/import?dry_run=true|false` — Admin, CSV upload
- v7.0: `width_mm`, `height_mm`, `thickness_mm` are numeric fields (source of truth for R4)
- `dimensions` field is auto-derived from numeric fields on write (display-only)

### R2: SKU Propose/Approve/Reject Cycle (WF-10)
- `POST /api/v1/skus/propose` — Designer only, no price fields, `status = PROPOSED`
  - `proposed_by = auth.uid()`
  - Cannot set `unit_cost_paise` or `sell_price_paise` (Designer never sets price)
  - Validates: category, name, unit required; `width_mm`/`height_mm` for WALL_PANEL
- `GET /api/v1/skus?status=PROPOSED` — Admin sees the proposal queue
- `POST /api/v1/skus/:sku/approve` — Admin only
  - Body: `{unit_cost_paise, sell_price_paise}` (Admin sets pricing at approval)
  - Transitions `PROPOSED → ACTIVE`
  - **Self-approval guard (AD-20):** `proposed_by != approving_user_id` enforced at DB
    - **Why the guard exists despite being currently unreachable:** `user_role_enum` is
      single-valued today (DESIGNER ≠ ADMIN), so the same account can never both propose
      and approve. The DB guard is defense-in-depth for: (a) test/demo accounts,
      (b) future multi-role if ever added.
    - **What this does NOT address:** rubber-stamping (Admin approving without real
      quality review). That's a business-process concern, not a technical guard.
      "Structurally impossible" means "same account can't do both" — it does NOT mean
      "independent review is guaranteed."
    - **Frozen assumption:** single-role-per-user (`user_role_enum` is one value, not
      an array or junction table). If this ever changes, AD-20's DB guard becomes the
      actual enforcement layer, not just defense-in-depth. Flag for revisit at that point.
- `POST /api/v1/skus/:sku/reject` — Admin only
  - Body: `{reason}` (required)
  - Transitions `PROPOSED → REJECTED`
  - Designer notified (`notification_type_enum = SKU_REJECTED`)
- **REJECTED → resubmit:** Designer can edit any field except `sku` on a REJECTED row,
  then resubmit → `status → PROPOSED` (same row, not a new one)
- **Full transition diagram:** PROPOSED→ACTIVE (approve), PROPOSED→REJECTED (reject),
  REJECTED→PROPOSED (resubmit), ACTIVE↔INACTIVE (toggle, Admin-only, either direction)
- **`product_library.sku` is immutable** for the row's entire life, through every state

### R2b: Admin-Direct vs Designer-Proposed — Validation Symmetry (explicit)
- **Both paths** go through identical field-level validation in the API endpoint:
  category enum, required fields (name, unit), dimension requirements per category
  (WALL_PANEL requires `width_mm`/`height_mm`), valid enum values for all columns.
- **The asymmetry is lifecycle, not validation:**
  - Admin-direct: field-validated → immediately `status = ACTIVE` (no review gate)
  - Designer-proposed: field-validated → `PROPOSED` → Admin reviews → sets pricing → `ACTIVE`
- **This is intentional, not a gap:** Admin is explicitly a trusted role with direct
  CRUD authority (Part 2: "SKU Master — direct create/edit/deactivate"). The proposal
  cycle exists because Designers lack pricing authority, not because SKU creation needs
  two-person review.
- **No 10-point Smart Validation applies to SKUs:** The 10-point validation is for
  *templates* (WF-11, R4). SKU validation is field-level checks only. A SKU is a single
  product record, not a composed artifact — its "validation" is just data integrity.

### R3: Design Template Lifecycle (WF-11)
- **DRAFT** — Designer creates, fully editable, saved incrementally
  - `POST /api/v1/design-library` — creates DRAFT template
  - `PATCH /api/v1/design-library/:id` — updates (DRAFT only, own templates)
  - `POST /api/v1/design-library/:id/glb` — upload GLB asset
  - `POST /api/v1/design-library/:id/elements` — add/replace design elements
  - `POST /api/v1/design-library/:id/consumables` — add/replace consumables
- **Validation** — repeatable, any time from DRAFT
  - `POST /api/v1/design-library/:id/validate` — runs 10-point Smart Validation
  - Returns per-check PASS/FAIL with itemized reasons (not just aggregate)
- **READY_FOR_REVIEW** — submission blocked until all 10 checks pass
  - `POST /api/v1/design-library/:id/submit-review` — `DRAFT → READY_FOR_REVIEW`
  - Template becomes read-only to Designer
  - Admin notified (`TEMPLATE_SUBMITTED_FOR_REVIEW`)
- **PUBLISHED** — Admin publishes
  - `POST /api/v1/design-library/:id/publish` — `READY_FOR_REVIEW → PUBLISHED`
  - Sets `published_at`, visible in Consultant Design Library
- **Request Changes** — Admin sends back to Designer
  - Returns to DRAFT with comment, Designer notified (`TEMPLATE_CHANGES_REQUESTED`)
- **ARCHIVED** — Admin-only, one-way, from PUBLISHED only
  - `POST /api/v1/design-library/:id/archive` — `PUBLISHED → ARCHIVED`
  - Removed from Consultant library; existing projects unaffected
- **Emergency unpublish** — Admin-only, logged, not standard flow
  - `POST /api/v1/design-library/:id/unpublish` — `PUBLISHED → DRAFT` (reason required)
  - **Self-approval guard analog:** the Admin who publishes and the Admin who
    unpublishes can be the same person — this is explicitly allowed because
    unpublish is an error-correction action, not an approval

### R4: 10-Point Smart Validation (frozen per check)
| # | Check | PASS condition |
|---|---|---|
| 1 | Template Information | `template_name`, `space_type`, `theme`, `price_range`, `template_type` all non-null |
| 2 | GLB Assets | ≥1 `digital_assets` row with `asset_type='GLB'`, `is_active=TRUE`; thumbnail present |
| 3 | Product Compatibility | every `design_elements.sku` resolves to `product_library` with `status='ACTIVE'` |
| 4 | Furniture Compatibility | furniture elements respect slot matrix (max 1 TV_CONSOLE, no unresolved collisions) |
| 5 | Inventory Availability | every referenced SKU's `is_active=TRUE` |
| 6 | Production Rules | `min_width_mm < max_width_mm` AND `min_height_mm < max_height_mm`, both non-null |
| 7 | Installation Rules | installation_type consistent with lighting (COVE_LIGHT/PROFILE_LIGHT requires FRAME_BASED) |
| 8 | Dynamic BOM Readiness | ≥1 `PRIMARY` product_role element exists |
| 9 | Quotation Readiness | every `template_consumables.condition_field/value` references a real config field |
| 10 | Publication Readiness | checks 1–9 PASS + `compatible_spaces` non-empty + `compatible_materials` non-empty |

### R5: GLB Asset Readiness Gate (Frozen Decision 10)
- Three.js/viewer work per design collection doesn't start until that collection
  has ≥1 PUBLISHED template with an active GLB asset
- This is a build-sequencing rule, not a runtime constraint
- Sprint 3 enforces: a template cannot be PUBLISHED without Check 2 passing (GLB exists)

### R6: Furniture Slot Matrix Guards (Part 3)
- Max 5 furniture items per space
- Max 1 TV Console per space
- No duplicate `default_position` on same space (unless one is `CUSTOM`)
  → `422 SLOT_ALREADY_OCCUPIED`
- These guards apply to `design_elements` with furniture SKUs during template building

### R7: SKU Immutability After Deactivation
- Deactivating a SKU (`ACTIVE → INACTIVE`) never touches history
- `bom_lines` / `configuration_line_items` freeze their own costs at time of use
- Deactivated SKU just stops being selectable for NEW template BOMs
- Fails HC-5 hard-constraint filter going forward (Sprint 4)

---

## Pre-Write Checklist Application (Sprint 3 specific)

Applying `.kiro/steering/pre-write-checklist.md` to Sprint 3's scope:

| Checklist category | Sprint 3 application |
|---|---|
| **Postgres functions** | SKU approve/reject may need RPC (atomic status + notification). Template submit/publish may need RPC (status + notification + readonly enforcement). |
| **Multi-step writes** | approve = update status + set pricing + notification — 3 operations, candidate for RPC |
| **DELETE operations** | Template archive doesn't DELETE (status change only). SKU deactivate doesn't DELETE (status change). No Sprint 3 DELETEs that would hit the FK issue. |
| **RLS helpers** | Designer policies already exist (AD-8: `auth.designer_draft_template_ids()`). No new helpers needed unless the propose-queue view requires one. |
| **Crypto** | No new sensitive data encryption in Sprint 3. |
| **Service-role queries** | Admin's proposal queue + review queue — similar pattern to T8 workload (admin client, explicit scoping, needs negative test). |
| **Self-approval guard** | NEW for Sprint 3 — SKU propose→approve must prevent same user. Template publish doesn't have this issue (Admin publishes Designer's work, never their own). |

---

## Design

### SKU State Machine

```
                   Designer proposes
                         │
                         ▼
    ┌─────────────── PROPOSED ──────────────────┐
    │                    │                       │
    │ Admin approves     │ Admin rejects         │
    │ (+ sets pricing)   │ (reason required)     │
    │                    ▼                       │
    │              ┌─ REJECTED ──┐               │
    │              │    │        │               │
    │              │    │ Designer edits         │
    │              │    │ + resubmits            │
    │              │    └────────────────────────┘
    │              │             │
    ▼              │             │
 ACTIVE ◀──────────┘             │
    │  ▲                         │
    │  │  Admin toggles          │
    ▼  │                         │
 INACTIVE                        │
                                 │
 (Admin direct-create: → ACTIVE immediately, bypasses PROPOSED entirely)
```

### Template State Machine

```
              Designer creates
                    │
                    ▼
   ┌──────────── DRAFT ◀────────────────────────┐
   │               │                             │
   │  Submit       │ Admin requests changes      │
   │  (all 10     │ (comment required)           │
   │   checks     │                              │
   │   PASS)      │                              │
   │              ▼                              │
   │   READY_FOR_REVIEW ────────────────────────┘
   │               │
   │  Admin        │
   │  publishes    │
   │              ▼
   │         PUBLISHED ──── Admin archives (one-way) ──── ARCHIVED
   │               │
   │  Emergency    │
   │  unpublish    │
   │  (reason req) │
   └───────────────┘
```

### SKU Approve RPC (atomic)

Per pre-write checklist: approve = update status + set pricing + notification = 3 steps.
If pricing update succeeds but notification fails, the SKU is active but nobody knows.
Wrap in RPC:

```sql
CREATE OR REPLACE FUNCTION approve_sku_proposal(
  p_sku VARCHAR,
  p_approver_id UUID,
  p_unit_cost_paise BIGINT,
  p_sell_price_paise BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
...
  -- Self-approval guard (AD-20): proposed_by != approver
  IF _product.proposed_by = p_approver_id THEN
    RAISE EXCEPTION 'SELF_APPROVAL_NOT_ALLOWED' ...
  END IF;
  
  -- Atomic: status + pricing + notification in one transaction
...
$$;
```

### Endpoint Structure

```
supabase/functions/
├── api-skus/
│   ├── index.ts          # Router: CRUD + propose + approve + reject
│   ├── propose.ts        # POST /skus/propose (Designer)
│   ├── approve.ts        # POST /skus/:sku/approve (Admin, calls RPC)
│   └── reject.ts         # POST /skus/:sku/reject (Admin)
├── api-design-library/
│   ├── index.ts          # Router: CRUD + lifecycle
│   ├── validate.ts       # POST /:id/validate (10-point)
│   ├── submit.ts         # POST /:id/submit-review
│   ├── publish.ts        # POST /:id/publish
│   ├── archive.ts        # POST /:id/archive
│   └── unpublish.ts      # POST /:id/unpublish (emergency)
```

---

## Tasks

### T1: SKU CRUD (Admin direct path)
- [ ] Create Edge Function `api-skus/index.ts`:
  - `POST /api/v1/skus` — Admin, creates with `status=ACTIVE`, validates category enum,
    auto-derives `dimensions` from numeric fields
  - `PATCH /api/v1/skus/:sku` — Admin, all fields except `sku` (immutable)
  - `GET /api/v1/skus` — all staff, paginated, filterable
  - `POST /api/v1/skus/:sku/deactivate` — Admin, `ACTIVE→INACTIVE`
    - Guard: `409 SKU_IN_USE` if referenced by PUBLISHED template design_elements
- [ ] Pre-checklist: no DELETE operations, no multi-step writes, no RPC needed
- [ ] Test: `sku` field rejected on PATCH (immutable)
- [ ] Test: deactivate blocked when SKU in PUBLISHED template

### T2: SKU Propose (Designer path)
- [ ] Create `api-skus/propose.ts`:
  - Designer only, `status=PROPOSED`, `proposed_by=auth.uid()`
  - Rejects if body contains `unit_cost_paise` or `sell_price_paise` (Designer never sets price)
  - Validates: category, name, unit required; dimensions for WALL_PANEL
- [ ] Pre-checklist: single INSERT, no atomicity concern
- [ ] Test: price fields in body → 422 (Designer can't set pricing)

### T3: SKU Approve (Admin, atomic RPC)
- [ ] Create migration `00011_create_sku_approval_rpc.sql`:
  - `approve_sku_proposal(p_sku, p_approver_id, p_unit_cost_paise, p_sell_price_paise)`
  - SECURITY DEFINER + SET search_path = public
  - GRANT EXECUTE TO authenticated, service_role
  - Guards: SKU must be PROPOSED, self-approval blocked (AD-20)
  - Atomic: update status/pricing + set is_active=TRUE + notification
  - ⚠️ CO-MAINTENANCE markers on RAISE EXCEPTION sites
- [ ] Create `api-skus/approve.ts`:
  - Admin only, calls RPC, maps errors
- [ ] Test: self-approval → 422 (AD-20)
- [ ] Test: approve non-PROPOSED SKU → 409
- [ ] Test: successful approve sets pricing + ACTIVE + notification row exists

### T4: SKU Reject + Resubmit
- [ ] Create `api-skus/reject.ts`:
  - Admin only, body `{reason}` required
  - `PROPOSED → REJECTED`, notification to proposer
- [ ] Resubmit path: Designer PATCHes a REJECTED SKU (any field except `sku`),
  then calls propose again? Or is it an explicit resubmit endpoint?
  - Per spec: "editable by their Designer (any field except `sku`) and resubmittable
    — same row, not a new one" → **PATCH on REJECTED row moves it back to PROPOSED**
  - RLS already allows Designer UPDATE on own REJECTED SKUs (policy exists in 00006)
- [ ] Test: reject without reason → 422
- [ ] Test: Designer edits REJECTED SKU → status stays REJECTED until explicit resubmit
- [ ] Test: resubmit → PROPOSED, back in queue

### T5: Template CRUD (Designer, DRAFT only)
- [ ] Create Edge Function `api-design-library/index.ts`:
  - `POST /api/v1/design-library` — Designer/Admin, creates DRAFT
  - `PATCH /api/v1/design-library/:id` — Designer (own, DRAFT only)
  - `POST /api/v1/design-library/:id/glb` — Designer, GLB upload to Supabase Storage
  - `POST /api/v1/design-library/:id/elements` — Designer, full replacement of elements
  - `POST /api/v1/design-library/:id/consumables` — Designer, full replacement
  - `GET /api/v1/design-library` / `/:id` — all staff
- [ ] Pre-checklist: elements/consumables replacement → check FK (no child refs in Sprint 3)
- [ ] Test: Designer can only edit own DRAFT templates
- [ ] Test: PATCH on non-DRAFT template → 403

### T6: 10-Point Smart Validation
- [ ] Create `api-design-library/validate.ts`:
  - Runs all 10 checks against the template's current state
  - Returns per-check result `{check_number, check_name, passed, reason?}`
  - Repeatable, any time from DRAFT
- [ ] Each check is a separate function (testable independently)
- [ ] Test: each of the 10 checks individually (PASS and FAIL cases)
- [ ] Test: Check 7 (Installation Rules) — COVE_LIGHT + DIRECT = FAIL

### T7: Template Submit/Publish/Archive/Unpublish (state transitions)
- [ ] Create `api-design-library/submit.ts`:
  - `DRAFT → READY_FOR_REVIEW`, blocked unless all 10 checks PASS
  - Notification to Admin (`TEMPLATE_SUBMITTED_FOR_REVIEW`)
- [ ] Create `api-design-library/publish.ts`:
  - `READY_FOR_REVIEW → PUBLISHED`, Admin only
  - Sets `published_at`
  - "Request Changes" variant: `READY_FOR_REVIEW → DRAFT` (comment required)
  - Notification to Designer (`TEMPLATE_CHANGES_REQUESTED`)
- [ ] Create `api-design-library/archive.ts`:
  - `PUBLISHED → ARCHIVED`, Admin only, one-way, sets `archived_at`
- [ ] Create `api-design-library/unpublish.ts`:
  - `PUBLISHED → DRAFT`, Admin only, reason required, emergency-only
  - Logged (not silent)
- [ ] Pre-checklist: submit = status change + notification = candidate for RPC (or acceptable
  as two calls since partial failure is visible: status changes but no notification → Admin
  sees it in queue regardless). Decision: acceptable as two calls — notification failure
  doesn't leave a corrupt state, just a missed alert.
- [ ] Test: submit without all 10 checks PASS → 422
- [ ] Test: archive is one-way (cannot un-archive)
- [ ] Test: full lifecycle: DRAFT→validate→submit→publish→archive

### T8: Furniture Slot Matrix (design_elements validation)
- [ ] When adding/replacing design_elements with furniture SKUs:
  - Max 1 TV_CONSOLE per template
  - No duplicate `default_position` on same template (unless CUSTOM)
  - `422 SLOT_ALREADY_OCCUPIED`
- [ ] Test: 2 TV_CONSOLE elements → 422
- [ ] Test: same position twice (not CUSTOM) → 422

### T9: Gate Tests
- [ ] WF-10 full cycle: propose → reject → edit → resubmit → approve
- [ ] WF-11 full cycle: DRAFT → validate (fail, fix, pass) → submit → publish → archive
- [ ] Self-approval guard (AD-20): same user propose + approve → blocked
- [ ] SKU deactivation: blocked if in PUBLISHED template, allowed if only in DRAFT/ARCHIVED
- [ ] Template validation: each of 10 checks fails independently with itemized reason
- [ ] Template archive: no effect on existing projects (existing data unaffected)
- [ ] Negative: Designer cannot publish, Designer cannot approve own SKU, Designer cannot
  see other Designers' proposals (RLS scoping)

---

## Architectural Decisions (to be made during Sprint 3)

| Candidate | Question | Resolution path |
|---|---|---|
| AD-20 | Self-approval guard on SKU approve | Enforce at DB (RPC checks `proposed_by != approver`). Structurally impossible in prod (single role per user), but defense-in-depth for test accounts. |
| AD-21 (candidate) | Template submit: two calls (status + notification) vs RPC | Notification failure doesn't corrupt state — acceptable as two calls unlike T7's assignment. |
| AD-22 (candidate) | SKU resubmit: explicit endpoint vs PATCH-sets-PROPOSED | Spec says "editable and resubmittable" — need to decide if PATCH auto-transitions or requires explicit action. |

---

## Done Criteria (from Part 13)

> *Done when:* a template clears all 10 checks to PUBLISHED; an archive has
> zero effect on any in-flight project; a SKU completes a full
> propose→reject→edit→resubmit→approve cycle.

Specifically:
1. ✅ Admin creates a SKU directly (status=ACTIVE, dimensions auto-derived)
2. ✅ Designer proposes a SKU (no pricing), Admin approves with pricing
3. ✅ Designer proposes, Admin rejects (reason), Designer edits + resubmits, Admin approves
4. ✅ Self-approval blocked (AD-20)
5. ✅ SKU deactivation blocked when referenced by PUBLISHED template
6. ✅ Designer creates template DRAFT with GLB + elements + consumables
7. ✅ Validation runs, shows per-check PASS/FAIL, blocks submission on any FAIL
8. ✅ All 10 checks pass → submit → Admin publishes
9. ✅ Admin archives a PUBLISHED template → no effect on existing projects
10. ✅ Emergency unpublish (logged, reason required)
11. ✅ Furniture slot matrix guards enforced during element creation
