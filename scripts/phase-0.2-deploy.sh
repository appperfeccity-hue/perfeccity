#!/bin/bash
# ============================================================
# PHASE 0.2 — Step 1: Redeploy all Edge Functions from REAL source
# ============================================================
# Run this from the repo root in an environment with:
#   - Supabase CLI installed (`supabase --version`)
#   - Authenticated to project demfvizmxkuxvluopmtq
#   - Outbound HTTPS to supabase.co
#
# This replaces the hand-simplified compact deploys from Phase 0.1
# with the actual source files from the repository.
#
# Prerequisites:
#   supabase link --project-ref demfvizmxkuxvluopmtq
#   (or use `npx supabase` if not globally installed)
# ============================================================

set -e

PROJECT_REF="demfvizmxkuxvluopmtq"
FUNCTIONS_DIR="supabase/functions"

echo "=== PHASE 0.2 STEP 1: Redeploy from real source ==="
echo "Project: $PROJECT_REF"
echo "Source: $FUNCTIONS_DIR"
echo ""

# Guard: working tree must be clean (no uncommitted edits, no stale artifacts)
# This is what makes "CLI deploy = source identity" actually true.
DIRTY=$(git status --porcelain 2>/dev/null)
if [ -n "$DIRTY" ]; then
  echo "❌ ABORT: Working tree is not clean. Uncommitted changes detected:"
  echo "$DIRTY"
  echo ""
  echo "Phase 0.2 must run against a clean checkout of the certified commit."
  echo "Either commit/stash your changes, or run from a fresh 'git clone'."
  exit 1
fi

CURRENT_COMMIT=$(git rev-parse --short HEAD)
echo "Commit: $CURRENT_COMMIT (verified clean)"
echo ""

# List of all deployable functions (api-design-library excluded — no index.ts)
FUNCTIONS=(
  "api-auth-login"
  "api-consultation"
  "api-design-dna"
  "api-leads"
  "api-leads-activities"
  "api-leads-assign"
  "api-leads-transition"
  "api-manufacturing"
  "api-price-preview"
  "api-quotation"
  "api-review"
  "api-scheduling"
  "api-skus"
  "api-users"
  "customer-auth-login"
  "customer-portal"
  "webhook-razorpay"
)

# Functions that should NOT verify JWT (login endpoints + webhooks + customer portal)
NO_JWT_FUNCTIONS=("api-auth-login" "customer-auth-login" "customer-portal" "webhook-razorpay")

PASS_COUNT=0
FAIL_COUNT=0
RESULTS=""

for fn in "${FUNCTIONS[@]}"; do
  echo "--- Deploying: $fn ---"
  
  # Check if function should skip JWT verification
  NO_JWT=""
  for nj in "${NO_JWT_FUNCTIONS[@]}"; do
    if [ "$fn" = "$nj" ]; then
      NO_JWT="--no-verify-jwt"
      break
    fi
  done
  
  # Deploy using Supabase CLI
  if supabase functions deploy "$fn" --project-ref "$PROJECT_REF" $NO_JWT 2>&1; then
    echo "  ✅ $fn deployed successfully"
    RESULTS="$RESULTS\n$fn | DEPLOYED | ✅"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  ❌ $fn FAILED to deploy"
    RESULTS="$RESULTS\n$fn | FAILED | ❌"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
  echo ""
done

echo "============================================"
echo "PHASE 0.2 STEP 1 RESULTS"
echo "============================================"
echo -e "$RESULTS"
echo ""
echo "PASS: $PASS_COUNT / ${#FUNCTIONS[@]}"
echo "FAIL: $FAIL_COUNT / ${#FUNCTIONS[@]}"
echo ""

if [ $FAIL_COUNT -eq 0 ]; then
  echo "STEP 1 VERDICT: PASS"
else
  echo "STEP 1 VERDICT: FAIL — $FAIL_COUNT function(s) failed to deploy"
  exit 1
fi
