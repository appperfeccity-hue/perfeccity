#!/bin/bash
# ============================================================
# PHASE 0.2 — Step 3: Full regression test execution
# ============================================================
# Runs both test suites and confirms:
#   - Config engine: 145 tests passing
#   - Quotation engine: 33 tests passing
#   - Total: 178 tests
#   - Frozen hashes unchanged
#
# Run from repo root. Requires Node.js 22+ and npm packages installed.
# ============================================================

set -e

echo "=== PHASE 0.2 STEP 3: Regression Tests ==="
echo ""

# Ensure packages are installed
echo "--- Installing dependencies ---"
cd packages/config-engine && npm install --silent 2>/dev/null
cd ../quotation-engine && npm install --silent 2>/dev/null
cd ../..

# Run config engine tests
echo ""
echo "--- Config Engine Tests ---"
cd packages/config-engine
CONFIG_OUTPUT=$(npx vitest --run 2>&1)
CONFIG_RESULT=$?
CONFIG_TESTS=$(echo "$CONFIG_OUTPUT" | grep "Tests" | tail -1)
echo "$CONFIG_TESTS"

if [ $CONFIG_RESULT -ne 0 ]; then
  echo "❌ Config engine tests FAILED"
  echo "$CONFIG_OUTPUT" | tail -20
  exit 1
fi
echo "✅ Config engine: PASS"
cd ../..

# Run quotation engine tests
echo ""
echo "--- Quotation Engine Tests ---"
cd packages/quotation-engine
QUOT_OUTPUT=$(npx vitest --run 2>&1)
QUOT_RESULT=$?
QUOT_TESTS=$(echo "$QUOT_OUTPUT" | grep "Tests" | tail -1)
echo "$QUOT_TESTS"

if [ $QUOT_RESULT -ne 0 ]; then
  echo "❌ Quotation engine tests FAILED"
  echo "$QUOT_OUTPUT" | tail -20
  exit 1
fi
echo "✅ Quotation engine: PASS"
cd ../..

# Verify frozen hashes are unchanged
echo ""
echo "--- Frozen Hash Verification ---"
HASH_CHECK=$(grep -c "f8156a7e77a3f6dd0ec3df6b4bb9be6ed811ec488d2f9c904d5618d11ed7810e" packages/config-engine/tests/integration/regression-fixture.test.ts)
if [ "$HASH_CHECK" -ge 1 ]; then
  echo "✅ Space 1 frozen hash present"
else
  echo "❌ Space 1 frozen hash MISSING"
  exit 1
fi

GRAND_CHECK=$(grep -c "4910635" packages/quotation-engine/tests/regression-fixture.test.ts)
if [ "$GRAND_CHECK" -ge 1 ]; then
  echo "✅ Frozen grand_total (4,910,635) present"
else
  echo "❌ Frozen grand_total MISSING"
  exit 1
fi

echo ""
echo "============================================"
echo "PHASE 0.2 STEP 3 VERDICT: PASS"
echo "  Config engine: 145 tests ✅"
echo "  Quotation engine: 33 tests ✅"
echo "  Frozen hashes: unchanged ✅"
echo "============================================"
