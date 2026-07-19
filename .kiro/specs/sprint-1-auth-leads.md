# Sprint 1 — Foundation, Identity, Leads

## Requirements

Source: Engineering Handover v7.0, Part 13 (Sprint 1 definition), Part 2 (Roles),
Part 4 (WF-1, WF-2), Part 7 (Auth + Leads endpoints), Part 11 (Seed data).

### R1: Staff Authentication via Supabase Auth
- Staff users (ADMIN, MANAGER, SALESPERSON, DESIGNER) authenticate via Supabase Auth
- JWT access tokens (15min expiry) contain role claim in `app_metadata.role`
- A Postgres custom access token hook enriches tokens with the user's current role
  from the `users` table at issuance time
- Login endpoint: `POST /api/v1/auth/login` → `{access_token, user}` + HttpOnly
  rotated refresh cookie
- Error codes: `401 INVALID_CREDENTIALS`, `403 ACCOUNT_INACTIVE`, `403 PENDING_SETUP`,
  `429 RATE_LIMITED` (10 failed/IP/15min)
- Role changes take effect at next token refresh (≤15min lag, acceptable for MVP)

### R2: Customer Authentication (same Auth instance, separate flow)
- Customers use the same Supabase Auth instance with `app_metadata.role = 'CUSTOMER'`
- Login endpoint: `POST /customer/v1/auth/login` → same envelope, customer token scope
- `customer_accounts` table is a profile extension linked via Supabase Auth UID
- Customer tokens can only access `/customer/v1/*` endpoints; staff tokens cannot
  access `/customer/v1/*` and vice versa (enforced by namespace middleware)

### R3: RBAC Middleware
- Every API request passes through RBAC middleware that:
  1. Validates the JWT (signature + expiry)
  2. Extracts `app_metadata.role` from the token
  3. Checks the role against the endpoint's allowed roles (per Part 7 matrix)
  4. Returns `403 FORBIDDEN` if the role is not permitted
- RLS policies on Supabase side enforce the same rules at the data layer
  (defense in depth — both must agree)

### R4: Lead Creation (WF-1)
- `POST /api/v1/leads` — Admin or Consultant
- Creates a lead with: customer_name, mobile (E.164, unique among active leads),
  lead_source, city, project_type → `status = NEW`
- Mobile is encrypted before storage (`mobile_encrypted`), hashed for uniqueness
  check (`mobile_hash`)
- Duplicate detection: `409 DUPLICATE_LEAD` if `mobile_hash` already exists
  for a non-LOST lead

### R5: Lead Assignment (WF-2)
- `POST /api/v1/leads/:id/assign` — Manager (primary), Admin (override)
- Body: `{consultant_id}`
- Sets: `assigned_consultant_id`, `assigned_by_manager_id`, `assigned_at`,
  `status → ASSIGNED`
- Guard: `409 LEAD_ALREADY_ASSIGNED` if lead status is not `NEW`
- This guard is enforced at the **Postgres function level** (not just app validation):
  a `assign_lead_to_consultant` RPC function checks `status = 'NEW'` inside the
  transaction and raises an exception if violated
- Consultant is notified (`notification_type_enum = LEAD_ASSIGNED`)

### R6: Lead Queue (Manager view)
- `GET /api/v1/leads?status=NEW` — Manager
- Returns unassigned leads, oldest-first (ordered by `created_at ASC`)
- Each lead shows: customer_name, city, project_type, lead_source, created_at
- Manager also sees active Consultants with their live open-consultation counts
  (derived from `projects` WHERE `consultant_id = X` AND `status IN (...)`)

### R7: Seed Data (Part 11)
- On first deployment, seed the database with Part 11's exact data:
  5 users, 3 pricing settings, 24 SKUs, 3 templates, 3 leads at `NEW`
- Seeded users must be created in Supabase Auth (not just the `users` table)
  with their `app_metadata.role` set correctly

### R8: Response Envelope Convention
- Every endpoint returns: `{ data: {...}, errors: [] }` on success
- On failure: `{ data: null, errors: [{code, message, field?}] }`
- Pagination: `{ data: [...], pagination: {page, per_page, total} }`
- Status codes per Part 7 general conventions

### R9: Admin User Management
- `POST /api/v1/users` — Admin only — creates a staff user in both Supabase Auth
  and the `users` table atomically
- `GET /api/v1/users` — Admin only — lists all staff users
- `PATCH /api/v1/users/:id` — Admin only — update role/status/department
- Role change updates `users.role` and syncs `app_metadata.role` in Supabase Auth

---

## Design

### Auth Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Supabase Auth                          │
│  Single instance, all users (staff + customer)           │
│  app_metadata.role discriminates access                  │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────┐    ┌──────────────────────────┐   │
│  │ Custom Token Hook │    │ users table (profiles)    │   │
│  │ (Postgres fn)     │───▶│ role synced from auth     │   │
│  └──────────────────┘    └──────────────────────────┘   │
│                                                          │
└─────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
┌─────────────────┐          ┌─────────────────────────┐
│ Staff API        │          │ Customer Portal API      │
│ /api/v1/*        │          │ /customer/v1/*           │
│ RBAC middleware  │          │ RBAC middleware           │
│ (ADMIN/MGR/      │          │ (CUSTOMER only)          │
│  SALES/DESIGNER) │          │                          │
└─────────────────┘          └─────────────────────────┘
```

### Custom Access Token Hook

```sql
CREATE OR REPLACE FUNCTION auth.custom_access_token_hook(event JSONB)
RETURNS JSONB AS $$
DECLARE
  _user_role TEXT;
  _user_id UUID;
  claims JSONB;
BEGIN
  -- Look up the user's current role from our users table
  SELECT role::TEXT, user_id INTO _user_role, _user_id
  FROM public.users
  WHERE user_id = (event->>'user_id')::UUID;

  -- If not found in users table, check customer_accounts
  IF _user_role IS NULL THEN
    _user_role := 'CUSTOMER';
  END IF;

  -- Inject role into app_metadata in the token claims
  claims := event->'claims';
  claims := jsonb_set(claims, '{app_metadata,role}', to_jsonb(_user_role));

  -- Return modified event
  RETURN jsonb_set(event, '{claims}', claims);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Lead Assignment — Atomic Guard (Postgres RPC)

```sql
CREATE OR REPLACE FUNCTION assign_lead_to_consultant(
  p_lead_id UUID,
  p_consultant_id UUID,
  p_manager_id UUID
)
RETURNS JSONB AS $$
DECLARE
  _lead RECORD;
  _result JSONB;
BEGIN
  -- Lock the row to prevent concurrent assignment
  SELECT * INTO _lead
  FROM leads
  WHERE lead_id = p_lead_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEAD_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF _lead.status != 'NEW' THEN
    RAISE EXCEPTION 'LEAD_ALREADY_ASSIGNED' USING ERRCODE = 'P0002';
  END IF;

  -- Perform the assignment
  UPDATE leads SET
    assigned_consultant_id = p_consultant_id,
    assigned_by_manager_id = p_manager_id,
    assigned_at = now(),
    status = 'ASSIGNED',
    updated_at = now()
  WHERE lead_id = p_lead_id;

  -- Insert notification for the assigned consultant
  INSERT INTO notifications (recipient_id, type, message)
  VALUES (
    p_consultant_id,
    'LEAD_ASSIGNED',
    'You have been assigned a new lead: ' || _lead.customer_name
  );

  -- Return the updated lead
  SELECT to_jsonb(l.*) INTO _result
  FROM leads l WHERE l.lead_id = p_lead_id;

  RETURN _result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### API Route Structure

```
supabase/functions/
├── api-auth-login/          # POST /api/v1/auth/login
├── api-users/               # CRUD /api/v1/users
├── api-leads/               # CRUD /api/v1/leads
├── api-leads-assign/        # POST /api/v1/leads/:id/assign (calls RPC)
├── api-leads-activities/    # POST /api/v1/leads/:id/activities
├── api-leads-transition/    # POST /api/v1/leads/:id/transition
└── customer-auth-login/     # POST /customer/v1/auth/login
```

### Rate Limiting Strategy

- Track failed login attempts per IP in Redis (or Supabase Edge Function KV/memory)
- 10 failures per IP within 15 minutes → `429 RATE_LIMITED`
- Successful login resets the counter for that IP
- For MVP, a simple in-memory Map in the Edge Function with TTL cleanup is acceptable
  (single-instance deployment means no cross-instance coordination needed)

---

## Tasks

### T1: Supabase Auth Configuration + Custom Token Hook
- [ ] Configure Supabase Auth settings (JWT expiry 900s, email auth enabled)
- [ ] Create migration `00007_create_auth_hooks.sql`:
  - `auth.custom_access_token_hook` function that injects role from `users` table
  - Enable the hook in Supabase Dashboard (or via config.toml auth hooks)
- [ ] Update `supabase/config.toml` with auth hook configuration
- [ ] Test: token issued after login contains `app_metadata.role` matching `users.role`

### T2: User Creation Flow (Admin seeds users into Supabase Auth)
- [ ] Create Edge Function `api-users` handling:
  - `POST /api/v1/users` — creates user in Supabase Auth + inserts `users` row atomically
  - `GET /api/v1/users` — lists staff users (Admin only)
  - `PATCH /api/v1/users/:id` — updates role/status, syncs `app_metadata`
- [ ] RBAC check: only `ADMIN` role can access these endpoints
- [ ] On role change: update both `users.role` and Supabase Auth `app_metadata.role`
- [ ] Update seed script to create Supabase Auth entries for the 5 seeded users

### T3: Staff Login Endpoint
- [ ] Create Edge Function `api-auth-login`:
  - Accepts `{email, password}`
  - Calls `supabase.auth.signInWithPassword()`
  - Returns `{access_token, user: {user_id, email, role, full_name}}` in envelope
  - Sets HttpOnly refresh cookie (Supabase handles rotation)
- [ ] Error handling:
  - Invalid credentials → `401 INVALID_CREDENTIALS`
  - User status `INACTIVE` → `403 ACCOUNT_INACTIVE`
  - User status `PENDING_SETUP` → `403 PENDING_SETUP`
  - Rate limited → `429 RATE_LIMITED`
- [ ] Rate limiting: track failed attempts per IP (10/15min threshold)
- [ ] Test: successful login returns valid JWT with correct role claim

### T4: Customer Login Endpoint
- [ ] Create Edge Function `customer-auth-login`:
  - Same flow as staff login but validates `role = 'CUSTOMER'`
  - Returns only customer-safe fields (no `role` field in response — implicit)
- [ ] Guard: if authenticated user's role is not CUSTOMER, return `403 FORBIDDEN`
- [ ] Test: staff credentials on customer endpoint return `403`

### T5: RBAC Middleware (shared utility)
- [ ] Create `supabase/functions/_shared/middleware/rbac.ts`:
  - Extracts and validates JWT from `Authorization: Bearer` header
  - Reads `app_metadata.role` from decoded token
  - Accepts array of allowed roles; returns `403 FORBIDDEN` if not in list
  - Namespace guard: `/api/v1/*` rejects CUSTOMER; `/customer/v1/*` rejects non-CUSTOMER
- [ ] Create `supabase/functions/_shared/response.ts`:
  - `success(data)` → `{ data, errors: [] }`
  - `error(code, message, field?, status)` → `{ data: null, errors: [{code, message, field?}] }`
  - `paginated(data, page, per_page, total)` → `{ data, pagination: {page, per_page, total} }`
- [ ] Test: wrong role on any endpoint returns `403` with correct error code

### T6: Lead Creation (WF-1)
- [ ] Create Edge Function `api-leads`:
  - `POST` — validates required fields (customer_name, mobile E.164, lead_source, city,
    project_type), encrypts mobile, computes `mobile_hash`, inserts with `status = NEW`
  - `GET` — paginated list with role-based filtering:
    - Admin: all leads
    - Manager: all leads (for queue view)
    - Consultant: own assigned leads only
  - `GET /:id` — single lead detail with decrypted mobile (for authorized viewers)
- [ ] Mobile encryption: use `pgcrypto` (or Node crypto in Edge Function) for
  encrypt/hash before insert
- [ ] Duplicate guard: check `mobile_hash` uniqueness among non-LOST leads
  (`409 DUPLICATE_LEAD`)
- [ ] Test: duplicate mobile on active lead returns `409`; same mobile on LOST lead succeeds

### T7: Lead Assignment (WF-2) — Postgres RPC
- [ ] Create migration `00008_create_lead_assignment_rpc.sql`:
  - `assign_lead_to_consultant(p_lead_id, p_consultant_id, p_manager_id)` function
  - Row-level lock (`FOR UPDATE`) prevents concurrent assignment
  - Status check (`!= 'NEW'` → raises `LEAD_ALREADY_ASSIGNED`)
  - Inserts notification row on success
- [ ] Create Edge Function `api-leads-assign`:
  - `POST /api/v1/leads/:id/assign` — body `{consultant_id}`
  - RBAC: Manager (primary) or Admin (override)
  - Calls the RPC function; maps Postgres exceptions to HTTP error codes:
    - `LEAD_NOT_FOUND` → `404`
    - `LEAD_ALREADY_ASSIGNED` → `409`
  - Returns updated lead in envelope
- [ ] Test (Gate 4): Consultant cannot assign; non-NEW lead returns `409`;
  concurrent assignment attempts — only one succeeds

### T8: Lead Queue + Consultant Workload View
- [ ] Extend `GET /api/v1/leads?status=NEW` for Manager:
  - Returns leads ordered by `created_at ASC` (oldest first)
  - Each lead: `{lead_id, customer_name, city, project_type, lead_source, created_at}`
- [ ] Create endpoint (or extend leads response) for Consultant workload:
  - `GET /api/v1/users?role=SALESPERSON&active=true` returns each Consultant with
    `open_consultation_count` (COUNT of projects WHERE status IN
    ('PROJECT_CREATED','CONFIGURING','REVIEWED','QUOTED','PAYMENT_PENDING'))
- [ ] Test: leads appear oldest-first; Consultant counts are accurate

### T9: Lead Activities + Status Transitions
- [ ] `POST /api/v1/leads/:id/activities` — Admin or owning Consultant
  - Body: `{activity_type, note}` — logs a touch (call/visit/note)
- [ ] `POST /api/v1/leads/:id/transition` — Admin or owning Consultant
  - Body: `{to_status, reason?}` — validates transition is legal per Part 10 Gate 6:
    - Valid: NEW→ASSIGNED (via assign endpoint only), ASSIGNED→CONTACTED,
      CONTACTED→SCHEDULED, SCHEDULED→SURVEY_COMPLETED, SURVEY_COMPLETED→CONVERTED,
      any→LOST
    - Invalid (must fail): NEW→CONVERTED direct, NEW→CONTACTED without ASSIGNED
  - On CONVERTED: creates the `projects` row, sets `leads.converted_project_id`
- [ ] Test (Gate 6): illegal transitions return `422 INVALID_TRANSITION`

### T10: Updated RLS Policies + Auth Integration
- [ ] Review and update `00006_create_rls_policies.sql`:
  - Confirm `auth.user_role()` reads from `app_metadata` (not `user_metadata`)
  - Add policy for Manager to INSERT into leads for assign action
  - Verify `auth.user_id()` returns the correct UUID (maps Supabase Auth UID to
    `users.user_id` — may need a mapping function if they differ)
- [ ] Decision: use Supabase Auth UID as `users.user_id` directly (simplest) or
  maintain a mapping table. **Recommendation:** use Auth UID directly — set
  `users.user_id` = the Supabase Auth UUID at user creation time. This avoids
  any mapping overhead and makes `auth.uid()` == `users.user_id` everywhere.
- [ ] Test: each role can only see/modify rows they should per Part 2 matrix

### T11: CI Gate Tests (Sprint 1 subset)
- [ ] Gate 4 (Assignment Integrity):
  - Consultant cannot open Stage 1 on a lead where `assigned_consultant_id ≠ self`
    (deferred to Sprint 2 since Stage 1 doesn't exist yet — placeholder test)
  - Manager cannot assign an already-non-NEW lead → `409`
- [ ] Gate 6 (State Transition — lead subset):
  - `NEW → ASSIGNED` via assign endpoint: passes
  - `NEW → CONVERTED` direct: fails with `422`
  - `ASSIGNED → CONTACTED → SCHEDULED → SURVEY_COMPLETED → CONVERTED`: passes
- [ ] Contract tests:
  - Response envelope shape matches `{ data, errors }` / `{ data, pagination }`
  - `403 FORBIDDEN` for wrong roles on every endpoint
  - `429 RATE_LIMITED` after 10 failed logins
- [ ] Migration tests: `00007` and `00008` apply cleanly; rollback doesn't break schema

---

## Done Criteria (from Part 13)

> *Done when:* Admin creates one user per role; a lead is created, queued, and
> assigned; a duplicate assignment attempt correctly 409s; Gate 4 green.

Specifically:
1. ✅ Admin logs in and creates users for each of the 5 roles
2. ✅ A lead is created via `POST /api/v1/leads` with mobile uniqueness enforced
3. ✅ The lead appears in Manager's queue (`GET /api/v1/leads?status=NEW`)
4. ✅ Manager assigns the lead to a Consultant → `status = ASSIGNED`
5. ✅ A second assignment attempt on the same lead → `409 LEAD_ALREADY_ASSIGNED`
6. ✅ The assigned Consultant sees the lead in their own list
7. ✅ A notification row exists for the Consultant (`type = LEAD_ASSIGNED`)
8. ✅ Rate limiting blocks the 11th failed login from the same IP
9. ✅ All Gate 4 and Gate 6 (lead subset) tests pass
