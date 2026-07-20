# Sprint 7 — Manufacturing, Installation, Closure

## Scope (from Part 13)

The final sprint. Covers everything from payment confirmation to project closure:
manufacturing package generation, installation scheduling, rescheduling, and
the atomic close-out that marks a project CLOSED.

## Tables Required

| Table | Already exists? | Notes |
|---|---|---|
| `manufacturing_packages` | ✅ (migration 00004) | Needs `one_active_package_per_project` index |
| `installation_schedules` | ✅ (migration 00004) | |
| `installation_reschedule_log` | ✅ (migration 00004) | |
| `notifications` | ✅ (migration 00004) | with `notification_type_enum` |

## Task Breakdown

### T1: Manufacturing Package Generation (WF-6)

**Trigger:** `advance_payments.status = CONFIRMED` (automatic, not manual)
**Actor:** System (background worker)

Flow:
1. Payment confirmed → job enqueued (async, not blocking payment response)
2. Worker picks up job → checks duplicate protection index
3. Generates manufacturing package (ZIP: customer-proposal.pdf, internal-cost-summary.pdf,
   material-summary.pdf, bom-grouped.json, dimensions.csv, installation-drawings.pdf)
4. Uploads to S3 → `manufacturing_packages.status: GENERATING → READY`
5. On failure: retry up to 3× with backoff → then `FAILED` (Admin manual regenerate)

**Guards:**
- `one_active_package_per_project` partial unique index:
  `WHERE status IN ('GENERATING','READY')` — prevents duplicate generation
- A `FAILED` row doesn't block the index (allows regenerate to insert fresh)

**For MVP scope:** The actual PDF/ZIP generation is infrastructure-heavy (requires
PDF rendering, S3 uploads). The Sprint 7 deliverable is:
- The RPC/trigger that transitions project APPROVED → ORDERED
- The `422 PACKAGE_NOT_READY` guard on ORDERED transition
- The `manufacturing_packages` row lifecycle (GENERATING → READY or FAILED)
- Admin regenerate endpoint
- The duplicate-protection index enforcement

### T2: Project State Transitions (APPROVED → ORDERED → IN_PRODUCTION → INSTALLATION_SCHEDULED)

Endpoint: `POST /api/v1/projects/:id/transition`
Role: ADMIN, MANAGER
Body: `{ to: 'ORDERED' | 'IN_PRODUCTION' | 'INSTALLATION_SCHEDULED' }`

Guards per transition:
- APPROVED → ORDERED: `422 PACKAGE_NOT_READY` unless `manufacturing_packages.status = READY`
- ORDERED → IN_PRODUCTION: no additional guard (Manager confirms production started)
- IN_PRODUCTION → INSTALLATION_SCHEDULED: only if installation_schedules exists

Each transition writes `project_state_history`.

### T3: Installation Scheduling — First Schedule (WF-7)

Endpoint: `POST /api/v1/projects/:id/installation`
Role: MANAGER (primary), ADMIN (override)
Body: `{ date, slot: 'MORNING'|'AFTERNOON', notes? }`

Guards:
- `422 PAYMENT_NOT_CONFIRMED` unless `project.status = APPROVED` (or later)
- Project must have `manufacturing_packages.status = READY`
- `installation_schedules.project_id` is UNIQUE — single schedule per project

Creates: `installation_schedules` row with `status = CONFIRMED`
Notifies: Customer (`INSTALLATION_SCHEDULED`)

### T4: Installation Rescheduling (WF-8)

**Customer requests:**
Endpoint: `POST /customer/v1/projects/:id/reschedule-request`
Auth: magic token
Body: `{ reason? }`

Guards (in order):
1. `422 PROJECT_CLOSED` — if project.status = CLOSED
2. `422 INSTALLATION_ALREADY_COMPLETED` — if schedule status = COMPLETED
3. `422 TOO_LATE_TO_RESCHEDULE` — if scheduled_date < 48 hours away
4. `409 RESCHEDULE_ALREADY_PENDING` — if status = RESCHEDULE_REQUESTED

On pass: status → RESCHEDULE_REQUESTED, log row appended, Manager notified

**Manager approves:**
Endpoint: `PATCH /api/v1/projects/:id/installation/reschedule`
Role: MANAGER, ADMIN
Body: `{ date, slot }`

On approve: status → RESCHEDULED, new date/slot set, log row, customer notified

**Manager rejects:**
Endpoint: `PATCH /api/v1/projects/:id/installation/reject`
Role: MANAGER, ADMIN
Body: `{ reason }`

On reject: status reverts to prior, log row, customer notified with reason

### T5: Installation Completion (WF-9)

Endpoint: `POST /api/v1/projects/:id/installation/complete`
Role: MANAGER, ADMIN

Atomic:
- `project.status → CLOSED`
- `installation_schedules.status → COMPLETED`
- `project_state_history` entry

### T6: Admin Manufacturing Package Management

Endpoints:
- `GET /api/v1/manufacturing/projects/:id/package/:id` — view package status
- `GET /api/v1/manufacturing/projects/:id/package/:id/download` — download ZIP
- `POST /api/v1/manufacturing/projects/:id/package/regenerate` — re-run generation

Regenerate rule (frozen, WF-6):
- Only after technical failure (FAILED status)
- Never modifies configuration, pricing, BOM — output recovery only
- Uses existing immutable snapshot

### T7: Gate 5 + Gate 6 + E2E Tests

Gate 5 (Installation Guard):
- Schedule creation fails without APPROVED + package READY
- Reschedule request fails against all 4 WF-8 guards
- ORDERED transition fails without PACKAGE_NOT_READY cleared

Gate 6 (State Transition Integrity):
- Valid chain: APPROVED → ORDERED → IN_PRODUCTION → INSTALLATION_SCHEDULED → CLOSED
- Invalid: APPROVED → CLOSED direct (skips manufacturing/installation)
- Invalid: PAYMENT_PENDING → INSTALLATION_SCHEDULED direct

E2E fixture (full happy path):
- Lead → assign → consult → review → quote → approve → pay → package →
  ORDERED → IN_PRODUCTION → schedule → reschedule → approve reschedule →
  complete → CLOSED

## Done Criteria (from Part 13)

> *Done when:* a project moves APPROVED→ORDERED→IN_PRODUCTION→INSTALLATION_SCHEDULED,
> a reschedule is requested and approved, a second attempt inside 48 hours correctly
> rejects, the project reaches CLOSED, and the full E2E happy path (Part 10) is green.

Specifically:
1. ✅ APPROVED → ORDERED guarded by PACKAGE_NOT_READY
2. ✅ Manufacturing package lifecycle (GENERATING → READY/FAILED)
3. ✅ Duplicate protection index prevents double-generation
4. ✅ First schedule creates installation_schedules (CONFIRMED)
5. ✅ Customer reschedule request with all 4 guards
6. ✅ Manager approve/reject reschedule
7. ✅ 48-hour guard correctly rejects
8. ✅ Atomic CLOSED + COMPLETED
9. ✅ Admin regenerate (FAILED only, immutable snapshot)
10. ✅ Full E2E fixture: lead to CLOSED
