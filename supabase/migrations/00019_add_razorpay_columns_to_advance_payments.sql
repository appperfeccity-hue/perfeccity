-- Migration 00019: Add Razorpay columns to advance_payments (Sprint 6 T6)
--
-- Razorpay integration requires storing:
-- - razorpay_order_id: returned when we create the order (our reference to Razorpay)
-- - razorpay_payment_id: returned by webhook when payment is captured
-- - razorpay_signature: webhook signature for verification audit trail
--
-- The UNIQUE(project_id) constraint already enforces single-payment-per-project.
-- Idempotency: if razorpay_order_id is already set, return it instead of creating new.

ALTER TABLE advance_payments
  ADD COLUMN IF NOT EXISTS razorpay_order_id VARCHAR,
  ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR,
  ADD COLUMN IF NOT EXISTS razorpay_signature VARCHAR;

-- Index for webhook lookup (webhook sends razorpay_order_id)
CREATE INDEX IF NOT EXISTS idx_advance_payments_razorpay_order
  ON advance_payments(razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;
