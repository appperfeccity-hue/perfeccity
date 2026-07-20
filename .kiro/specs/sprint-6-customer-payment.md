# Sprint 6 — Customer Portal + UPI Payment (Razorpay)

## Architectural Principle (confirmed by Akshay)

**Seal ≠ Approve ≠ Pay ≠ Confirm Payment**

Each step has exactly one authority and one responsibility:

| Action | Authority | State Transition | Sprint |
|---|---|---|---|
| Generate & seal quotation | System (engine) | snapshot=SEALED, project=QUOTED | Sprint 5 (done) |
| Accept quotation | Customer | project: QUOTED → PAYMENT_PENDING | Sprint 6 |
| Confirm payment | Razorpay webhook | project: PAYMENT_PENDING → APPROVED | Sprint 6 |
| Schedule delivery/install | Manager | Post-APPROVED scheduling | Sprint 6 |

## Locked MVP Decisions

- **Payment Gateway:** Razorpay
- **Payment Method:** UPI only
- **Payment Confirmation Authority:** Razorpay webhook only (no human approval)
- **Customer approval required before payment:** Yes (sealed quotation must be accepted first)
- **Human payment approval:** None (webhook is sole authority)
- **Production release before payment:** Never
- **manager_id enforcement point:** APPROVED transition
- **Customer Portal:** Included in Sprint 6

## Sprint 5 Compatibility

Sprint 5's `persist_quotation_snapshot` correctly creates snapshots with `status = SEALED`
at generation time. Sprint 6 does NOT modify the sealing mechanism — the customer accepts
an already-sealed, immutable document. This preserves the seal's purpose: the customer is
accepting a document whose integrity can be independently verified.

## Task Breakdown

### T1: Customer Auth — Convert Flow

Convert a lead into a customer account with Supabase Auth user:
- Create `customer_accounts` row (linked to lead via `lead_id`)
- Create Supabase Auth user (with `app_metadata.role = 'CUSTOMER'`)
- Populate `customer_accounts.auth_user_id` atomically
- Create `customer_project_links` row (customer → project)
- **Compensating delete on failure** (same pattern as Sprint 1 T2, per DECISIONS.md)
- Triggered when project reaches QUOTED status (customer needs portal access)

Endpoint: `POST /api/v1/projects/:id/convert-to-customer`
Role: ADMIN or owning SALESPERSON

### T2: Customer Login

Endpoint: `POST /customer/v1/auth/login`
- Namespace-guarded (rejects non-CUSTOMER tokens per existing RBAC middleware)
- Returns JWT with `app_metadata.role = 'CUSTOMER'` (via hook)
- Rate-limited (same login_attempts pattern as staff)

### T3: Customer RLS

RLS policies for customer-visible tables:
- `quotation_snapshots`: customer sees only their linked projects' snapshots
- `projects`: customer sees only their linked projects (via `customer_project_links`)
- `bom_lines`: customer sees their linked projects' bom_lines
- **Forbidden keys suppressed:** `unit_cost_paise` NOT visible to customer (Part 7)
- New helper: `customer_project_ids()` (reads from `customer_project_links`)

### T4: Customer Portal — Quotation Display

Endpoint: `GET /customer/v1/projects/:id/quotation`
- Returns: sealed quotation summary (grand_total, step breakdown names, expires_at)
- Suppresses: unit costs, internal step values (Part 7 forbidden keys)
- Shows: grand_total_rupees, line item names/quantities (not costs), expiry date

### T5: Customer Approve Quotation

Endpoint: `POST /customer/v1/projects/:id/approve`
- Guards: project status = QUOTED, quotation not expired, quotation still SEALED
- Transitions: project QUOTED → PAYMENT_PENDING
- Records: customer approval timestamp, approval actor

### T6: Razorpay Order Creation

Endpoint: `POST /customer/v1/projects/:id/pay`
- Prerequisite: project status = PAYMENT_PENDING
- Creates Razorpay order via API (`amount = grand_total_paise`, `currency = INR`)
- Stores: `razorpay_order_id` on `advance_payments` row (status = PENDING)
- Returns: Razorpay order_id + payment link/UPI intent for frontend

### T7: Razorpay Webhook — Payment Confirmation

Endpoint: `POST /webhooks/razorpay` (no JWT — webhook-authenticated via signature)
- Verifies Razorpay webhook signature (HMAC-SHA256 with webhook secret)
- On `payment.captured` event:
  - Updates `advance_payments.status = CONFIRMED`
  - Transitions project: PAYMENT_PENDING → APPROVED
  - Enforces `manager_id` invariant (must be non-null at APPROVED)
  - Records `project_state_history` entry

### T8: Manager Scheduling

Endpoints:
- `PUT /api/v1/projects/:id/schedule/delivery` (sets delivery date)
- `PUT /api/v1/projects/:id/schedule/installation` (sets installation date)
- Role: ADMIN or MANAGER
- Prerequisite: project status = APPROVED

### T9: Customer Status Tracking

Endpoint: `GET /customer/v1/projects/:id/status`
- Returns: current project status, payment status, delivery date, installation date
- Customer sees their own projects only (RLS)

### T10: Price Preview

Endpoint: `GET /api/v1/projects/:id/price-preview`
- Returns: `Σ(configuration_line_items.sell_price_paise × quantity)` per space
- Role: owning SALESPERSON or ADMIN
- AD-33: Uses `sell_price_paise` directly, NOT the formal engine

### T11: Endpoints + Gate Tests

Full workflow verification:
1. Convert lead → customer account ✅
2. Customer login ✅
3. Customer views quotation ✅
4. Customer approves (QUOTED → PAYMENT_PENDING) ✅
5. Razorpay order created ✅
6. Razorpay webhook fires (PAYMENT_PENDING → APPROVED) ✅
7. manager_id enforced at APPROVED ✅
8. Manager schedules delivery + installation ✅
9. Customer sees updated status ✅

## Dependencies from Earlier Sprints

| Artifact | What Sprint 6 uses it for |
|---|---|
| `customer_accounts` table (migration 00004) | Customer profile storage |
| `customer_project_links` table (migration 00004) | Customer → project mapping |
| `customer_accounts.auth_user_id` (migration 00007b) | Auth ↔ profile link |
| `advance_payments` table (migration 00003) | Payment recording |
| `quotation_snapshots.status = SEALED` (Sprint 5) | Customer accepts sealed doc |
| `quotation_snapshots.expires_at` (Sprint 5) | Expiry guard on approval |
| RBAC namespace guard (Sprint 1) | `/customer/v1/*` routing |
| `custom_access_token_hook` (Sprint 1) | Injects CUSTOMER role for unknown users |
| AD-33 (T10) | `sell_price_paise` for preview |

## Pre-Write Checklist Application

Sprint 6-specific concerns (in addition to standard checklist):
- [ ] Razorpay webhook endpoint: NO JWT validation (webhook uses HMAC signature instead)
- [ ] Razorpay secrets: stored as Supabase secrets, never in code
- [ ] Customer cannot see `unit_cost_paise` (Part 7 forbidden keys)
- [ ] Compensating-delete on convert flow (AD-3 dependency, DECISIONS.md Sprint 6 note)
- [ ] `payment_method_enum` currently has 5 values — only UPI used for MVP
- [ ] `advance_payments.project_id` is UNIQUE — single-payment rule enforced by schema

## Done Criteria

> *Done when:* a customer can log in, view their sealed quotation, approve it,
> pay via UPI through Razorpay, and the system automatically transitions to
> APPROVED on webhook confirmation with manager_id enforced; Manager can then
> schedule delivery and installation; customer can track all status changes.

Specifically:
1. ✅ Convert flow creates customer account + Auth user atomically
2. ✅ Customer login works via `/customer/v1/auth/login`
3. ✅ Customer RLS isolates customer data correctly
4. ✅ Customer views quotation (forbidden keys suppressed)
5. ✅ Customer approve transitions QUOTED → PAYMENT_PENDING (with expiry guard)
6. ✅ Razorpay order creation returns valid order_id
7. ✅ Razorpay webhook confirms payment → APPROVED (with signature verification)
8. ✅ manager_id invariant enforced at APPROVED transition
9. ✅ Manager can schedule delivery + installation dates
10. ✅ Customer can view project status including dates
11. ✅ Price preview returns sell_price_paise totals (AD-33)
