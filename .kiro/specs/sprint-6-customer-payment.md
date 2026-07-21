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
- **Customer Auth:** Magic link via WhatsApp (Option A — no login, no password)
- **Token expiry:** 7 days or payment completion
- **No Supabase Auth user for customers** (simplification from Option A)

## Sprint 5 Compatibility

Sprint 5's `persist_quotation_snapshot` correctly creates snapshots with `status = SEALED`
at generation time. Sprint 6 does NOT modify the sealing mechanism — the customer accepts
an already-sealed, immutable document. This preserves the seal's purpose: the customer is
accepting a document whose integrity can be independently verified.

## Task Breakdown

### T1: Customer Provisioning (Automatic at QUOTED)

Provision customer access automatically when project transitions to QUOTED:
- Create `customer_accounts` row (linked to lead via `lead_id`) — idempotent
- Create `customer_project_links` row (customer → project)
- Generate cryptographically secure magic token (maps to customer_id + project_id)
- **No Supabase Auth user for customers** (Option A: magic link, no login)
- Token expiry: 7 days or payment completion, whichever comes first
- Triggered automatically during quotation generation (REVIEWED → QUOTED)

RPC: `provision_customer_access` (migration 00017, already deployed + verified)

### T2: Magic Token Generation + Verification

**No customer login endpoint.** Access is via time-limited magic link sent on WhatsApp.

Magic token design:
- Cryptographically secure random token (e.g., 32-byte hex or base64url)
- Stored in new `customer_access_tokens` table:
  `token_hash` (HMAC-SHA256 of token), `customer_id`, `project_id`, `expires_at`, `used_at`
- Token is sent to customer via WhatsApp (Consultant-triggered, separate from provisioning)
- Customer clicks link → token verified → scoped access to that project's quotation
- Token expires after 7 days OR after payment is confirmed
- **One token per project** (new token invalidates old one)

Endpoint: `POST /api/v1/projects/:id/generate-customer-link`
Role: owning SALESPERSON or ADMIN
Returns: the magic link URL (containing the raw token)

Verification endpoint: `GET /customer/v1/verify?token=<token>`
- Validates token (not expired, not used, hash matches)
- Returns: project_id, customer_id, quotation summary
- Sets a short-lived session cookie or returns a session token for subsequent requests

### T3: Token-Scoped Access Middleware

Replaces JWT-based RLS for customer portal routes:
- `/customer/v1/*` routes use token-scoped middleware (not JWT RBAC)
- Middleware extracts token from header/cookie, verifies against `customer_access_tokens`
- Scopes all queries to the specific `project_id` from the token
- **No RLS needed for customer access** — scoping is done at the middleware/endpoint level
- **Forbidden keys suppressed at the endpoint level** (not via RLS column exclusion)

### T4: Customer Portal — Quotation Display

Endpoint: `GET /customer/v1/projects/:id/quotation`
- Auth: magic token (via T3 middleware), scoped to this project
- Returns: sealed quotation summary (grand_total_rupees, line item names/quantities, expires_at)
- Suppresses: unit_cost_paise, internal step values (Part 7 forbidden keys)
- Shows: grand_total as rupees (formatted), space names, item descriptions, expiry date
- Guard: quotation must be SEALED and not expired

### T5: Customer Approve Quotation

Endpoint: `POST /customer/v1/projects/:id/approve`
- Auth: magic token (via T3 middleware)
- Guards: project status = QUOTED, quotation not expired, quotation still SEALED
- Transitions: project QUOTED → PAYMENT_PENDING
- Records: customer approval timestamp, customer_id as actor
- Returns: confirmation + payment instructions

### T6: Razorpay Order Creation

Endpoint: `POST /customer/v1/projects/:id/pay`
- Auth: magic token (via T3 middleware)
- Prerequisite: project status = PAYMENT_PENDING
- Creates Razorpay order via API (`amount = grand_total_paise`, `currency = INR`, `method = upi`)
- Creates `advance_payments` row (status = PENDING, stores `razorpay_order_id`)
- Returns: Razorpay order_id + payment link/UPI intent for frontend
- Razorpay API key: stored as Supabase secret

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
- Auth: magic token (via T3 middleware)
- Returns: current project status, payment status, delivery date, installation date
- Scoped to the token's project only

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
| `advance_payments` table (migration 00003) | Payment recording |
| `quotation_snapshots.status = SEALED` (Sprint 5) | Customer accepts sealed doc |
| `quotation_snapshots.expires_at` (Sprint 5) | Expiry guard on approval |
| RBAC namespace guard (Sprint 1) | `/customer/v1/*` routing (repurposed for token auth) |
| AD-33 (T10) | `sell_price_paise` for preview |

**NOT used (Option A simplification):**
- `customer_accounts.auth_user_id` — no Supabase Auth user for customers
- `custom_access_token_hook` CUSTOMER fallback — not exercised (no customer JWT)
- Customer RLS policies — not needed (token-scoped middleware instead)

## Pre-Write Checklist Application

Sprint 6-specific concerns (in addition to standard checklist):
- [ ] Razorpay webhook endpoint: NO JWT validation (webhook uses HMAC signature instead)
- [ ] Razorpay secrets: stored as Supabase secrets, never in code
- [ ] Customer cannot see `unit_cost_paise` (Part 7 forbidden keys — enforced at endpoint level)
- [ ] Magic token: HMAC-SHA256 hashed before storage (low entropy if short — use 32+ bytes)
- [ ] Token expiry enforced on every access (not just generation)
- [ ] `payment_method_enum` currently has 5 values — only UPI used for MVP
- [ ] `advance_payments.project_id` is UNIQUE — single-payment rule enforced by schema
- [ ] No customer RLS policies needed (token-scoped middleware handles isolation)
- [ ] `customer_accounts.auth_user_id` NOT populated (Option A: no Supabase Auth for customers)

## Done Criteria

> *Done when:* a customer can click a magic link from WhatsApp, view their sealed
> quotation, approve it, pay via UPI through Razorpay, and the system automatically
> transitions to APPROVED on webhook confirmation with manager_id enforced; Manager
> can then schedule delivery and installation; customer can track all status changes
> via the same token-scoped link.

Specifically:
1. ✅ Customer provisioning automatic at QUOTED (customer_accounts + project link)
2. ✅ Magic token generated and verifiable (time-limited, cryptographically secure)
3. ✅ Customer views quotation via magic link (forbidden keys suppressed)
4. ✅ Customer approve transitions QUOTED → PAYMENT_PENDING (with expiry guard)
5. ✅ Razorpay order creation returns valid order_id (UPI only)
6. ✅ Razorpay webhook confirms payment → APPROVED (with signature verification)
7. ✅ manager_id invariant enforced at APPROVED transition
8. ✅ Manager can schedule delivery + installation dates
9. ✅ Customer can view project status including dates (via token)
10. ✅ Price preview returns sell_price_paise totals (AD-33)
11. ✅ Token expires after 7 days or payment completion
