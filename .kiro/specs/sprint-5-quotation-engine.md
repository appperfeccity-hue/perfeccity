# Sprint 5 — Review Gate and Quotation Engine

## The seal verification standard (resolve BEFORE writing engine code)

### Normative Invariant (confirmed by Akshay)

> `quotation_snapshots.sha256_hash` MUST equal `SHA256(canonical_json(quotation_snapshots.seal_payload))`,
> and this value MUST be independently recomputable from the persisted `seal_payload`
> and the documented canonical serialization rules without requiring access to the live
> quotation engine or any secret material.

**What this means for implementation:**
- `seal_payload` stores the EXACT canonical JSON that was hashed (not a summary, not a subset)
- Any auditor with the stored `seal_payload` + Part 8's serialization rules + SHA-256 can verify
- The engine computes `sha256_hash` = `SHA256(canonical_json(seal_payload_object))`
- The engine stores BOTH `seal_payload` (the input) AND `sha256_hash` (the output) together
- The acceptance test reads ONLY `seal_payload` from the DB, hashes it, and verifies match

**What this does NOT provide (explicitly accepted tradeoff):**
- Does NOT prevent forgery by someone with DB write access (they could edit both columns)
- Does NOT use a secret key (no HMAC, no key management, no rotation concern)
- Tamper-evidence against DB writers would require HMAC or digital signatures (Layer 2)

**Design choice (AD-28):** Plain SHA-256 over HMAC because the primary purpose is
auditability and reproducibility, not forgery-resistance against privileged insiders.
Same reasoning that chose configuration_hash as a plain SHA-256 in Sprint 4.
If forgery-resistance is ever needed, it's a deliberate upgrade to HMAC with a
managed key — not a silent change from what's documented here.

### Sprint 5 Acceptance Test (stronger than Sprint 4)

```
1. Run 13-step quotation engine → produces seal_payload + sha256_hash
2. Persist both to quotation_snapshots via RPC (atomic)
3. Read seal_payload back from DB (ONLY this column, not sha256_hash)
4. Canonicalize it using documented rules (sorted keys, no whitespace, UTF-8)
5. Compute SHA-256 independently
6. Assert: computed hash === stored sha256_hash === frozen Gate 1 value
```

This proves: the seal is self-contained and independently verifiable.
Sprint 4's test proved: stored data reproduces the stored hash.
Sprint 5's test proves: the stored hash IS the hash of the stored payload.
The distinction matters: Sprint 4 could theoretically have a payload that doesn't match its hash if they were computed from different data. Sprint 5 proves they're the same computation.

---

## Sprint 1–4 Dependencies

| Artifact | What Sprint 5 uses it for |
|---|---|
| Configuration Engine (145 tests, frozen hashes) | Steps 1–10 of the quotation engine consume config output |
| `computeConfigurationHash` / `canonicalize` (R8) | Same serialization rules, SEPARATE function (Part 8 explicit) |
| `persist_configuration` RPC pattern | Pattern for quotation seal persistence (atomic payload+hash) |
| `product_library.unit_cost_paise/sell_price_paise` | Step 4–5 pricing |
| `pricing_settings` (3 rows: labour direct/frame, transport) | Steps 8–9 |
| `quotation_snapshots` + `bom_lines` tables | Engine output destination |
| `review_records` table | WF-4 review gate output |
| AD-25 (array sort before hash) | Same discipline for seal payload arrays |
| AD-27 (public schema for functions) | Any new RPCs must be in public schema |
| Boundary-fidelity test pattern | Extended for seal verification |

---

## Requirements

Source: Part 4 (WF-4, WF-5), Part 5 (Domain 8), Part 7 (Review/Quotation endpoints),
Part 8 (13-step Quotation Engine, seal rules), Part 10 (Gate 1, Gate 2), Part 13 (Sprint 5).

### R1: Review Gate (WF-4) — 7-item checklist

`POST /api/v1/projects/:id/review` — owning Consultant

7-item checklist evaluated automatically:
1. Customer info complete (name, mobile, email non-null)
2. Design selected all spaces (every space has `selected_template_id`)
3. Samples verified all spaces (`sample_verified = TRUE`)
4. ≥1 site photo exists (`site_photographs` where `is_deleted = FALSE`)
5. Current config all spaces (every space has `is_current = TRUE` config)
6. All referenced SKUs `ACTIVE` (every SKU in current configs is active)
7. Budget confirmed (`budget_profiles.budget_tier` non-null)

PASS → `project.status = REVIEWED` → 13-step engine runs
FAIL → stays `CONFIGURING`, itemized failures returned, no engine run

Each attempt (pass or fail) creates a `review_records` row with `checklist_json`.

### R2: 13-Step Quotation Engine

Fixed constants: `MARGIN_RATE = 0.25`, `GST_RATE = 0.18`
Labour/transport from `pricing_settings`:
- `LABOUR_DIRECT_PAISE_PER_SQM = 15000` (₹150/sqm)
- `LABOUR_FRAME_PAISE_PER_SQM = 25000` (₹250/sqm)
- `TRANSPORT_FLAT_RATE_PAISE = 500000` (₹5,000/project, flat, once)

| Step | Logic | Output |
|---|---|---|
| 1 | Effective DNA per space | material_preference, design_style, etc. |
| 2 | Panel SKU data (numeric w/h/t from product_library) | Panel dimensions |
| 3 | Net areas (from space_configurations, already computed by Sprint 4) | Per-space net_area_sqmm |
| 4 | Panel cost: `Σ CEIL(area/(w×h)) × unit_cost_paise` | wall_panel_total_paise |
| 5 | Non-panel costs (trims + lighting + consumables from config) | trim_total + lighting_total + consumable_total |
| 6 | Structural check (base boards present for all FRAME_BASED) | validation pass/fail |
| 7 | Moisture verify (base board present for every HIGH-moisture space) | validation pass/fail |
| 8 | Labour: `Σ net_area_sqm × LABOUR_RATE[installation_type]` | labour_total_paise |
| 9 | Transport (flat, once per project) | transport_paise = 500000 |
| 10 | Furniture: `Σ configured_furniture.calculated_cost_paise` | furniture_total_paise |
| 11 | Subtotal (4+5+8+9+10) | subtotal_paise |
| 12 | Margin: `ROUND(subtotal × 0.25)` + pre-GST | pre_gst_total_paise |
| 13 | GST: `ROUND(pre_gst × 0.18)` + grand total + SHA-256 seal | grand_total_paise + sha256_hash |

### R3: SHA-256 Seal (Part 8, separate from configuration_hash)

Seal payload (alphabetical keys, per Part 8):
`generated_at, grand_total_paise, project_id, snapshot_id, step_breakdown, version`

**Timestamps INCLUDED** (opposite of configuration_hash — deliberate contrast).
**Two separate functions** (Part 8 explicit instruction):
- `computeConfigurationHash` — already built in Sprint 4 (excludes timestamps)
- `computeQuotationSeal` — Sprint 5 (includes timestamps)

Serialization rules: same as configuration_hash (canonical JSON, sorted keys, no whitespace, null omitted, numbers not strings).

### R4: Quotation Snapshot Storage

- `quotation_snapshots.status = DRAFT` initially
- `seal_payload` stores the exact canonical JSON that was hashed (audit guarantee)
- `sha256_hash` stores the hex output
- `step_breakdown` stores the full 13-step computation trace (JSONB)
- `expires_at = sealed_at + 7 days`

### R5: Quotation Expiry + Re-quote

- Unpaid past 7 days → `status = EXPIRED`
- Consultant triggers re-quote (13-step engine reruns against current SKU prices)
- New snapshot, new seal, new `expires_at`
- A failed payment attempt is NOT expiry (same snapshot, retry)

---

## Potential SI Candidates (flagged before implementation)

Based on reading Part 8's 13 steps for verbs vs formulas:

| # | Step | Potential ambiguity | Risk |
|---|---|---|---|
| SI-5? | Step 4 | "Panel cost" — does this use `unit_cost_paise` or `sell_price_paise`? The quotation is customer-facing, so probably sell price. But the spec says `unit_cost` in the formula. Needs checking. | Pricing error |
| SI-6? | Step 8 | Labour rate — "net_area_sqm" — is this net_area_sqmm/1000000 (sqmm→sqm)? Consistent with PER_SQM formula? | Labour miscalculation |
| SI-7? | Step 12 | `ROUND(subtotal × 0.25)` — ROUND to what precision? Nearest paise? Banker's rounding? JavaScript `Math.round`? | Rounding error compounds |
| SI-8? | Step 13 | `ROUND(pre_gst × 0.18)` — same rounding question | GST error |
| SI-9? | Step 11 | "Subtotal (4+5+8+9+10)" — does step 5 include ALL non-panel items from config, or only specific categories? | Missing costs |

These will be examined one at a time as each step is implemented. If any requires a spec-interpretation call, it gets the SI-N treatment (pause, surface, confirm) before code proceeds past it.

---

## Done Criteria (from Part 13)

> *Done when:* the gate correctly fails an incomplete project with itemized
> reasons and passes a complete one; the engine's output matches the regression
> fixture bit-for-bit; Gate 1 green.

Specifically:
1. ✅ Review gate fails with itemized reasons for each failing check
2. ✅ Review gate passes a complete project → status = REVIEWED
3. ✅ 13-step engine produces correct `grand_total_paise` for regression fixture
4. ✅ SHA-256 seal matches frozen value
5. ✅ Seal is independently verifiable from stored `seal_payload` alone
6. ✅ `expires_at = sealed_at + 7 days`
7. ✅ Re-quote path works (new snapshot, new seal, correct prices)
8. ✅ Gate 1 regression values frozen this sprint
