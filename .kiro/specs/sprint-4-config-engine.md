# Sprint 4 — Consultation Stages 5–7 & Configuration Engine

## The verification problem (resolve BEFORE writing engine code)

Sprint 4 transitions from "plumbing that's correct by construction" (auth, CRUD, state
machines) to "computation that's correct by assertion against known-good outputs."
The structural checklist (7 categories) remains necessary for endpoints/RPCs but is
**insufficient** for rule-engine correctness.

### Execution environment — RESOLVED

Tests CAN be executed in this sandbox:
- `vitest` runs (`unset NODE_OPTIONS && /root/.nvm/.../npx vitest --run`)
- `packages/config-engine/` has its own test runner
- Golden-output fixtures will be **authored AND run**, not just spec'd

This means Sprint 4 delivers a qualitatively different confidence level than
Sprints 1–3: actual test execution, not just authored assertions.

### Fixture provenance — two categories, different confidence levels

| Category | Source of truth | Confidence | Example |
|---|---|---|---|
| **Formula-derived** | Mechanical arithmetic from Part 8's frozen formulas. Expected output is computable by anyone with a calculator — no interpretation needed. | HIGH — wrong fixture is a math error, catchable by a second person. | `CEIL(9720000 / (200×2700)) = 18 panels` |
| **Spec-interpretation** | Prose from Part 4/8 that requires a judgment call about edge cases the spec doesn't explicitly state. Expected output depends on how you read the prose. | LOWER — wrong fixture looks correct unless someone re-derives from first principles. | `segment_b_mm = 0 vs NULL for L_SHAPE` — does 0 mean "straight segment of zero length" or "no segment"? |

**Rule for Sprint 4:** Every fixture MUST be labeled with its category.
- Formula-derived: include the arithmetic derivation inline (show your work)
- Spec-interpretation: include the prose being interpreted AND the interpretation choice,
  so a reviewer can disagree with the interpretation without questioning the arithmetic

### What "verified" means for a rule engine

A rule is "verified" when ALL of:
1. A golden-output fixture exists with the expected output **and its derivation**
2. The test passes (`vitest --run`, not placeholder)
3. The derivation traces back to a specific Part/line of the handover spec
4. Edge cases from the spec-interpretation category are flagged with their assumption

A rule is "authored but not verified" if any of 1–4 are missing.

---

## Sprint 1–3 Dependencies

| Artifact | What Sprint 4 uses it for |
|---|---|
| `application_spaces` (Sprint 2, Stage 4) | Spaces with measurements, wall_shape, selected_template_id |
| `space_configurations` + `configuration_line_items` | Engine output tables |
| `configured_furniture` (config-scoped, v7.0) | Furniture inputs to engine |
| `design_templates` + `design_elements` + `template_consumables` | Template data the engine reads |
| `product_library` (numeric `width_mm`/`height_mm`) | Panel dimensions for R4 formula |
| `one_current_config_per_space` partial unique index | Concurrent regeneration guard |
| `site_assessments.moisture_level` | R3 input (moisture-resistant base board) |
| AD-19 + FK cascade dependency (Pending) | Stage 4 resubmission must be blocked once spaces have configs |
| Pre-write checklist | Structural checks still apply to endpoints |
| `packages/config-engine/` | The engine package — isolated, unit-tested independently |

---

## Requirements

Source: Part 4 (WF-3, Stages 5–7), Part 8 (Configuration Engine R1–R9, area formulas,
quantity formulas, Recommendation Engine), Part 7 (consultation endpoints), Part 13 (Sprint 4).

### R1: Stage 5a — Design Selection (Recommendation Engine)
- `POST /api/v1/projects/:id/spaces/:space_id/recommendation` — runs engine
- `GET /api/v1/projects/:id/spaces/:space_id/recommendation` — reads result
- Hard Constraint Filter (HC-1 through HC-6):
  - HC-1: moisture mismatch (template incompatible with space's moisture_level)
  - HC-2: space incompatibility (template's compatible_spaces doesn't include this space_type)
  - HC-3: wall-shape mismatch
  - HC-4: over-budget (template's price_range exceeds project's budget_tier)
  - HC-5: inactive SKU (any template element references inactive product)
  - HC-6: material incompatibility (effective material_preference not in template's compatible_materials)
- Weighted scoring: `S = 0.30·style + 0.20·finish + 0.20·material + 0.15·lighting + 0.15·budget`
- Output: `match_score_percent = ROUND(S×100, 2)`

### R2: Stage 5b — Template Lock + Sample Verification
- `POST /api/v1/projects/:id/spaces/:space_id/select-template` — locks template
- `POST /api/v1/projects/:id/spaces/:space_id/verify-samples` — sets `sample_verified=TRUE`
- Guards: template must be PUBLISHED, space must not already have a template selected
  (or explicit deselect-then-reselect)

### R3: Stage 6 — Site Assessment
- `PUT /api/v1/projects/:id/consultation/stage/6` — owning Consultant
- Saves to `site_assessments`: wall_type, moisture_level, has_electrical, lift/parking
- Requires ≥1 site photo uploaded
- Requires Stage 5 complete (all spaces have template + sample verified)

### R4: Stage 7 — Final Measurements + Configuration Engine
- `POST /api/v1/projects/:id/spaces/:space_id/measurements` — triggers engine
- Validates measurements against template tolerance (`min/max_width_mm`, `min/max_height_mm`)
  → `422 MEASUREMENT_OUT_OF_TOLERANCE`
- Validates template is selected → `422 TEMPLATE_NOT_SELECTED` (Gate 3)
- On valid measurements: runs Configuration Engine (R1–R9) automatically

### R5: Configuration Engine — 9 Rules (packages/config-engine)
| Rule | Logic | Fixture category |
|---|---|---|
| R1 | lighting→installation type mapping | Formula-derived (lookup table) |
| R2 | Base board thickness by lighting type | Formula-derived (fixed values) |
| R3 | Moisture +5mm stacking with R2 | Formula-derived (addition) |
| R4 | Panel quantity: `CEIL(net_area/(w×h))` | Formula-derived (arithmetic) |
| R5 | Auto-link TRIM matching colour+finish | **Spec-interpretation** (matching logic) |
| R6 | Structural board consumable addition | Formula-derived (conditional) |
| R7 | Consumables from template_consumables with conditions | **Spec-interpretation** (condition evaluation) |
| R8 | SHA-256 configuration_hash | Formula-derived (deterministic serialization) |
| R9 | Archive old config, insert new (is_current swap) | Structural (state machine, not computation) |

### R6: Area Formulas (frozen — shared by engine and quotation)
| Wall shape | Formula | Fixture category |
|---|---|---|
| STRAIGHT | `width_mm × height_mm` | Formula-derived |
| L_SHAPE | `(width_mm × height_mm) + (segment_b_mm × height_mm)` | Formula-derived |
| C_SHAPE | `(width_mm × height_mm) + (segment_b_mm × height_mm) + (segment_c_mm × height_mm)` | Formula-derived |

`net_area_sqmm = gross_area_sqmm − opening_deduction_sqmm` (must be > 0)

**Spec-interpretation edge cases (flag, don't assume):**
- `segment_b_mm = NULL` for STRAIGHT: treated as 0 (not used in formula)
- `segment_b_mm = 0` for L_SHAPE: mathematically valid (adds 0), but is this a data
  entry error? Spec doesn't state. **Decision needed:** reject as invalid input (422)
  or accept and produce 0 additional area? Recommend: accept (0 is a valid measurement;
  the formula works correctly with it; the Consultant entered it deliberately).
- `opening_deduction_sqmm > gross_area_sqmm`: spec explicitly says `422 INVALID_NET_AREA`

### R7: Quantity Formulas
- `PER_PANEL = CEIL(net_area_sqmm / (width_mm × height_mm))` — CEIL mandatory, never ROUND/FLOOR
- `PER_SQM` — quantity per square meter
- `PER_RFT_PERIMETER = 2(width_mm + height_mm) / 304.8 × factor`
- `PER_RFT_HEIGHT = height_mm / 1000 × factor`
- `FIXED_PER_SPACE` — literal fixed quantity
- `FIXED_PER_PROJECT` — once per project, not per space

### R8: price-preview endpoint (Consultant tablet)
- `GET /consultant/v1/spaces/:id/price-preview` — Consultant only, own prefix
- Returns exactly 4 keys: `wall_panel_paise, lighting_paise, furniture_paise, grand_total_paise`
- Category subtotals only, never per-accessory

### R9: AD-19 FK cascade resolution (Pending from Sprint 2)
- Stage 4 resubmission must now be BLOCKED once a space has downstream data
  (`space_configurations`, `space_measurements`, `configured_furniture` rows exist)
- Add a guard in `replace_project_spaces` RPC: if any space for this project has
  child rows in these tables → `422 SPACES_LOCKED_BY_CONFIGURATION`
- This is the resolution of the Sprint 2 Pending dependency

---

## Verification Model (the leading design question, answered)

### Golden-output fixture: the 3-space regression fixture from Part 8

The spec defines a specific regression fixture (Part 8/Part 10 Gate 1):
- `TV_UNIT_WALL` 3600×2700 STRAIGHT/WPC Oak/COVE_LIGHT/PREMIUM
- `BED_BACK_WALL` 3000×2700 STRAIGHT/WPC Oak/NONE/PREMIUM
- `BATHROOM_WALL` 2400×2700 STRAIGHT/PVC White/NONE/STANDARD/moisture=HIGH

This fixture produces `expected_grand_total_paise` and `expected_sha256_hash` frozen
at Sprint 5 completion (quotation engine). For Sprint 4, we freeze the **configuration
outputs** (line items, quantities, configuration_hash) using the same fixture inputs.

### Sprint 4 test execution plan

```
packages/config-engine/
├── src/
│   ├── rules/
│   │   ├── r1-installation-type.ts
│   │   ├── r2-base-board.ts
│   │   ├── r3-moisture.ts
│   │   ├── r4-panel-quantity.ts
│   │   ├── r5-trim-auto-link.ts
│   │   ├── r6-structural-board.ts
│   │   ├── r7-consumables.ts
│   │   ├── r8-configuration-hash.ts
│   │   └── r9-archive-and-insert.ts
│   ├── formulas/
│   │   ├── area.ts          (STRAIGHT/L_SHAPE/C_SHAPE)
│   │   └── quantity.ts      (PER_PANEL/PER_SQM/PER_RFT/FIXED)
│   └── index.ts             (orchestrator: runs R1–R9 in sequence)
├── tests/
│   ├── rules/
│   │   ├── r1.test.ts       (truth table: every input combination)
│   │   ├── r2.test.ts       (fixed values: NONE→0, PROFILE→5, COVE→10)
│   │   ├── r3.test.ts       (stacking: R2 + 5mm for HIGH moisture)
│   │   ├── r4.test.ts       (CEIL formula: multiple panel sizes)
│   │   ├── r5.test.ts       (colour+finish matching logic)
│   │   ├── r6.test.ts       (conditional: FRAME_BASED → add board)
│   │   ├── r7.test.ts       (condition evaluation per template_consumables)
│   │   └── r8.test.ts       (hash determinism + canonical serialization)
│   ├── formulas/
│   │   ├── area.test.ts     (all 3 shapes + net_area + edge cases)
│   │   └── quantity.test.ts (CEIL, PER_SQM, PER_RFT formulas)
│   └── integration/
│       └── regression-fixture.test.ts (the 3-space fixture, full pipeline)
```

ALL tests are **actually executed** via `vitest --run` in this sprint — not placeholders.

### Derivation tracing (every fixture documents its source)

```typescript
// Formula-derived fixture — derivation shown inline:
it('TV_UNIT_WALL 3600×2700 STRAIGHT produces 18 WPC Oak panels', () => {
  // Source: Part 8, R4: PER_PANEL = CEIL(net_area_sqmm / (width_mm × height_mm))
  // Inputs: width=3600, height=2700, wall_shape=STRAIGHT
  // gross_area = 3600 × 2700 = 9,720,000 sqmm
  // opening_deduction = 0 (no openings)
  // net_area = 9,720,000 - 0 = 9,720,000 sqmm
  // panel: WLP-WPC-CLS-OAK-001, width_mm=200, height_mm=2700
  // PER_PANEL = CEIL(9720000 / (200 × 2700)) = CEIL(18.0) = 18
  expect(computePanelQuantity(9720000, 200, 2700)).toBe(18);
});

// Spec-interpretation fixture — assumption stated:
it('L_SHAPE with segment_b_mm=0 produces same as STRAIGHT', () => {
  // Source: Part 8 area formula: (width×height) + (segment_b×height)
  // Interpretation: segment_b_mm=0 is valid input (adds 0 to gross area)
  // Assumption: 0 is NOT rejected as invalid — it's a measurement the Consultant
  // entered deliberately. A wall shaped as L but with zero-length second segment
  // is geometrically a straight wall expressed in L_SHAPE format.
  // FLAG: If this interpretation is wrong, this fixture's expected value is wrong.
  const gross = computeGrossArea('L_SHAPE', 3000, 2700, 0);
  expect(gross).toBe(3000 * 2700); // same as STRAIGHT
});
```

---

## Tasks

### T0: Resolve AD-19 FK cascade dependency (Sprint 2 Pending)
- [ ] Update `replace_project_spaces` RPC:
  - Before DELETE, check if any space for this project has child rows
  - If yes → RAISE EXCEPTION 'SPACES_LOCKED_BY_CONFIGURATION'
  - If no → proceed with delete+insert (existing behavior)
- [ ] Pre-checklist: modifying existing RPC — verify search_path/grants still correct
- [ ] Test: Stage 4 resubmission after Stage 5/7 has run → 422

### T1: Area formulas (packages/config-engine/src/formulas/area.ts)
- [ ] Implement `computeGrossArea(wall_shape, width_mm, height_mm, segment_b_mm?, segment_c_mm?)`
- [ ] Implement `computeNetArea(gross_area_sqmm, opening_deduction_sqmm)`
- [ ] Guard: `422 INVALID_NET_AREA` if net ≤ 0
- [ ] **Test (EXECUTED):** all 3 shapes with derivations shown
- [ ] **Test:** segment_b_mm=0 for L_SHAPE (spec-interpretation, assumption documented)
- [ ] **Test:** opening_deduction > gross → error

### T2: Quantity formulas (packages/config-engine/src/formulas/quantity.ts)
- [ ] `computePanelQuantity(net_area_sqmm, panel_width_mm, panel_height_mm)` → CEIL
- [ ] Other formulas: PER_SQM, PER_RFT_PERIMETER, PER_RFT_HEIGHT, FIXED_PER_SPACE, FIXED_PER_PROJECT
- [ ] **Test (EXECUTED):** PER_PANEL with multiple inputs confirming CEIL (not ROUND/FLOOR)
- [ ] **Test:** edge case: net_area exactly divisible → CEIL still works (no off-by-one)

### T3: Rules R1–R3 (lighting/installation/baseboard/moisture)
- [ ] R1: lighting_type → installation_type mapping (truth table)
- [ ] R2: base board thickness: NONE→0, PROFILE→5, COVE→10
- [ ] R3: moisture HIGH → +5mm (stacks with R2)
- [ ] **Test (EXECUTED):** truth table for R1 (every combination)
- [ ] **Test:** R2+R3 stacking (COVE+HIGH = 10+5 = 15mm)

### T4: Rule R4 (panel quantity)
- [ ] Uses `computePanelQuantity` from T2
- [ ] Reads `product_library.width_mm`/`height_mm` (v7.0 numeric source of truth)
- [ ] Produces `configuration_line_items` rows for wall panels
- [ ] **Test (EXECUTED):** regression fixture space 1 (TV_UNIT_WALL, 18 panels)
- [ ] **Test:** UV_MARBLE panel (600×1200) — different dimensions, different count

### T5: Rules R5–R7 (trim, structural board, consumables)
- [ ] R5: auto-link TRIM SKU matching colour+finish → `422 TRIM_SKU_NOT_FOUND` if none
- [ ] R6: if R2/R3 board needed → add matching CONSUMABLE base board SKU
- [ ] R7: evaluate `template_consumables.condition_field/value` against config state
- [ ] **Test (EXECUTED):** R5 finds matching trim for WPC Oak
- [ ] **Test:** R5 fails when no trim matches (422)
- [ ] **Test:** R7 condition evaluation (installation_type=FRAME_BASED → include, moisture=HIGH → include)

### T6: Rule R8 (configuration_hash)
- [ ] Canonical serialization per Part 8 rules:
  - UTF-8, sorted keys (recursive), no whitespace, numbers not strings, null omitted
  - Timestamps EXCLUDED (answers "same configuration?")
- [ ] SHA-256 of the canonical JSON
- [ ] **Test (EXECUTED):** same inputs → same hash (deterministic)
- [ ] **Test:** different inputs → different hash
- [ ] **Test:** field ordering doesn't matter (keys sorted)
- [ ] **Test:** null fields omitted (not serialized as null)

### T7: Rule R9 (archive old config, insert new)
- [ ] Set old `space_configurations.is_current = FALSE`
- [ ] Insert new row with `is_current = TRUE`
- [ ] `one_current_config_per_space` partial unique index enforces at most one
- [ ] Furniture edits after this point attach to the new config_id (v7.0)
- [ ] Pre-checklist: multi-step write (UPDATE old + INSERT new). Atomicity?
  - Assessment: both operations on the same table, simple toggle. If INSERT fails,
    old config stays current (no worse-than-either state). Accept as two calls.
    Unlike spaces (where DELETE + INSERT = zero state), here UPDATE to FALSE + failed
    INSERT = old config remains current (safe). AD-21 applies.
- [ ] **Test:** concurrent regeneration → partial unique index prevents 2 current

### T8: Integration — full pipeline (regression fixture)
- [ ] Wire R1–R9 into `packages/config-engine/src/index.ts`
- [ ] Run against 3-space regression fixture (Part 8)
- [ ] **Test (EXECUTED):** full pipeline produces expected line items
- [ ] **Test:** configuration_hash matches expected value (frozen at sprint end)

### T9: Stage 5–7 Endpoints
- [ ] Stage 5a: recommendation engine endpoint
- [ ] Stage 5b: template selection + sample verification
- [ ] Stage 6: site assessment (requires Stage 5 complete + photo)
- [ ] Stage 7: measurements → triggers engine → returns configuration
- [ ] Guards: MEASUREMENT_OUT_OF_TOLERANCE, TEMPLATE_NOT_SELECTED, TEMPLATE_MATERIAL_MISMATCH
- [ ] Pre-checklist: Stage 7 triggers engine (multi-step write: measurements + config).
  The engine run itself is wrapped — but is the "save measurements + run engine"
  combination atomic? Assessment: measurements are append-only (space_measurements),
  engine creates new config (space_configurations). If engine fails after measurement
  saved, measurement exists but no config — this is a valid intermediate state
  (measurement recorded, config pending). Not worse-than-either. AD-21 applies.

### T10: price-preview endpoint
- [ ] `GET /consultant/v1/spaces/:id/price-preview`
- [ ] Returns exactly 4 keys: wall_panel_paise, lighting_paise, furniture_paise, grand_total_paise
- [ ] Consultant-only, own prefix (namespace guard)
- [ ] **Test:** response has exactly these 4 keys (no extras, no unit costs)

### T11: Gate Tests
- [ ] Gate 3: Stage 7 blocked without template → 422 TEMPLATE_NOT_SELECTED
- [ ] Gate 3: Stage 7 succeeds and auto-runs engine with template
- [ ] Configuration Engine 3 test layers (Part 13 Sprint 4 requirement):
  1. Each R1–R9 tested individually
  2. Area formulas each as own test (not folded into full-config test)
  3. Full configuration snapshot asserting exact hash
- [ ] `one_current_config_per_space` concurrency test
- [ ] AD-19 resolution: Stage 4 resubmission blocked after config exists

---

## Done Criteria (from Part 13)

> *Done when:* Gate 3 passes, all three test layers pass, area-formula tests match
> Part 8's table exactly, and the one_current_config_per_space concurrency test passes.

Specifically:
1. ✅ Recommendation engine filters + scores templates for a space
2. ✅ Template locked on space, samples verified
3. ✅ Site assessment saved (Stage 6)
4. ✅ Measurements validated against template tolerance
5. ✅ Configuration Engine runs R1–R9 producing correct line items (**actually tested**)
6. ✅ Area formulas correct for all 3 shapes (**actually tested**)
7. ✅ PER_PANEL formula uses CEIL (**actually tested**)
8. ✅ configuration_hash is deterministic (**actually tested**)
9. ✅ price-preview returns exactly 4 keys
10. ✅ Gate 3: TEMPLATE_NOT_SELECTED guard works
11. ✅ Concurrency: one_current_config_per_space holds under parallel writes
12. ✅ AD-19 resolved: Stage 4 resubmission blocked post-configuration
