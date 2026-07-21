# Phase 4 — Razorpay Test-Mode Validation Plan

## Objective

Validate that the payment flow (T6 order creation + T7 webhook confirmation) works
correctly against Razorpay's test-mode API, then flip `RAZORPAY_VALIDATED=true` to
unlock the payment endpoint for customers.

## Prerequisites

1. **Razorpay test-mode credentials** (from dashboard.razorpay.com):
   - `RAZORPAY_KEY_ID` (starts with `rzp_test_...`)
   - `RAZORPAY_KEY_SECRET`
   - `RAZORPAY_WEBHOOK_SECRET` (configured in Razorpay Dashboard → Webhooks)

2. **Supabase secrets set:**
   ```bash
   supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxxxx
   supabase secrets set RAZORPAY_KEY_SECRET=xxxxx
   supabase secrets set RAZORPAY_WEBHOOK_SECRET=xxxxx
   ```

3. **Deploy** (must be done before testing):
   ```bash
   supabase functions deploy customer-portal
   supabase functions deploy webhook-razorpay
   ```

4. **Test project in PAYMENT_PENDING status** with a sealed quotation.

## Test Steps

### Test 1: Order Creation (T6)

**What to call:**
```bash
# Get a customer magic-link token first (or use a pre-seeded one)
curl -X POST "$BASE/functions/v1/customer-portal/projects/$PROJECT_ID/pay" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected (with RAZORPAY_VALIDATED=false, current state):**
```json
{ "data": null, "errors": [{ "code": "PAYMENT_NOT_READY", "message": "Payment integration is pending validation..." }] }
```
HTTP 503.

**Expected (after setting RAZORPAY_VALIDATED=true):**
```json
{
  "data": {
    "project_id": "...",
    "razorpay_order_id": "order_xxxxx",
    "amount_paise": 4910635,
    "amount_rupees": "49106.35",
    "currency": "INR",
    "method": "upi",
    "message": "Payment order created. Complete payment via UPI."
  }
}
```
HTTP 200.

**Validation criteria:**
- `razorpay_order_id` starts with `order_` (Razorpay's format)
- `amount_paise` matches the sealed quotation's `grand_total_paise`
- `advance_payments` row created with `status = 'PENDING'`
- Calling again returns same `razorpay_order_id` (idempotent)

### Test 2: Webhook Verification (T7)

**Simulate Razorpay webhook** (test-mode allows manual trigger from dashboard,
or construct the payload manually):

```bash
# Compute HMAC-SHA256 signature
BODY='{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_test123","order_id":"order_xxxxx","amount":4910635,"status":"captured","method":"upi"}}}}'
SIGNATURE=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$RAZORPAY_WEBHOOK_SECRET" | awk '{print $2}')

curl -X POST "$BASE/functions/v1/webhook-razorpay" \
  -H "x-razorpay-signature: $SIGNATURE" \
  -H "Content-Type: application/json" \
  -d "$BODY"
```

**Expected (200):**
```json
{ "received": true, "payment_confirmed": true, "project_status": "APPROVED" }
```

**Validation criteria:**
- `advance_payments.status` → `CONFIRMED`
- `advance_payments.razorpay_payment_id` = `pay_test123`
- `projects.status` → `APPROVED`
- `project_state_history` row: `PAYMENT_PENDING → APPROVED`
- Calling again (retry): returns 200 with `already_confirmed: true`

### Test 3: Signature Rejection

```bash
curl -X POST "$BASE/functions/v1/webhook-razorpay" \
  -H "x-razorpay-signature: invalid_signature_here" \
  -H "Content-Type: application/json" \
  -d '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"x","order_id":"x","amount":100,"status":"captured","method":"upi"}}}}'
```

**Expected:** HTTP 401.

### Test 4: Non-captured Event (ignored gracefully)

```bash
BODY='{"event":"payment.authorized","payload":{"payment":{"entity":{"id":"x","order_id":"x","amount":100,"status":"authorized","method":"upi"}}}}'
SIGNATURE=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$RAZORPAY_WEBHOOK_SECRET" | awk '{print $2}')

curl -X POST "$BASE/functions/v1/webhook-razorpay" \
  -H "x-razorpay-signature: $SIGNATURE" \
  -H "Content-Type: application/json" \
  -d "$BODY"
```

**Expected:** HTTP 200 with `{ "received": true, "event": "payment.authorized" }` (acknowledged, not processed).

## PASS Criteria

All 4 tests pass → set env var:
```bash
supabase secrets set RAZORPAY_VALIDATED=true
```

Then re-deploy `customer-portal`:
```bash
supabase functions deploy customer-portal
```

Verify the gate opens:
```bash
# Same pay call as Test 1 — should now return order_id instead of 503
```

## Blockers

- **Network:** Sandbox cannot reach `api.razorpay.com`. Tests must run from an
  egress-capable environment (local machine, CI runner, etc.)
- **Credentials:** Test-mode keys from Razorpay dashboard required.
- **Test data:** Need a project in PAYMENT_PENDING with a sealed quotation.
  Can seed via RPC or use existing regression fixture data.

## Code Changes Required

None. T6 and T7 are already implemented and deployed. Phase 4 is pure verification
(same pattern as Phase 0.2 — run scripts, evaluate output, flip gate).
