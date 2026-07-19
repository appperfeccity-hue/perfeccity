# PERFECCITY — MVP Engineering Handover v7.0

> This file is the authoritative specification for the PERFECCITY MVP build.
> It contains Parts 0–15 of the complete engineering handover document.
> All implementation must trace back to specific Parts of this document.
> Part 15 items are PENDING — do not implement without explicit sign-off.
>
> **Related:** [DECISIONS.md](./DECISIONS.md) — running log of implementation
> decisions (AD-1 through AD-N) that deviate from or extend the frozen spec
> due to infrastructure choices (Supabase stack). Check before assuming the
> ERD exactly matches what's deployed.

## Quick Reference

- **Part 1** — Platform Soul & Doctrine (Governing Sentence, 10 Frozen Decisions, Immutability Rule)
- **Part 2** — Roles & Permissions (5 roles, full permission matrix)
- **Part 3** — Product Architecture (SKU categories, furniture slots, space types)
- **Part 4** — Master Workflow Catalog (WF-1 through WF-11)
- **Part 5** — Full Database Schema (36 tables, 11 domains)
- **Part 6** — Full Enumerations (every CREATE TYPE)
- **Part 7** — Full API Reference (staff + customer namespaces)
- **Part 8** — Configuration Engine & Quotation Engine (R1–R9, 13 steps)
- **Part 9** — Role-Wise UI/UX
- **Part 10** — Test Strategy (6 CI Gates)
- **Part 11** — Seed Data (Sprint 1 launch)
- **Part 12** — Production Architecture (superseded by Supabase stack — see build prompt)
- **Part 13** — Sprint 1–7 Build Sequence
- **Part 14** — ERD Changelog (v6.4 → v7.0)
- **Part 15** — Pending Architectural Decisions (DO NOT IMPLEMENT without sign-off)

## Governing Sentence (frozen)

One Customer → One Primary Wall (+ up to 4 secondary, max 5 spaces) →
One Consultation → One Approved Quotation → One Payment →
One Manufacturing Package → One Installation Schedule →
One Transformation Journey.

## 10 Frozen Architectural Decisions

1. Design selection before measurement
2. 100% advance payment, single record (advance_payments.project_id UNIQUE)
3. No-substitution enforcement after sealing
4. GLB files visualization-only, never parsed for BOM/pricing
5. All commercial data from DB records, never from 3D assets
6. 13-step deterministic quotation engine
7. SHA-256 sealed quotations
8. Manual data entry by Consultants, system validates
9. Labour/services modeled as SERVICE SKUs in product_library
10. GLB Asset Readiness Gate per design collection

## Non-negotiable Platform Rules

- Money in paise (BIGINT) — never floating point
- product_library.width_mm/height_mm/thickness_mm are numeric source of truth
- PER_PANEL = CEIL(net_area_sqmm / (width_mm × height_mm)) — CEIL mandatory
- Partial unique indexes: one_primary_wall_per_project, one_active_package_per_project, one_current_config_per_space
- Customer portal suppresses unit prices (forbidden keys list, Part 7)
- configuration_hash excludes timestamps; quotation seal includes them
- Two separate hash functions, never a shared utility with a boolean flag

## Part 15 — Pending (DO NOT IMPLEMENT)

1. Pointer FK integrity (projects.latest_*)
2. bom_lines conditional nullability by source
3. UNIQUE(projects.lead_id)
4. configuration_hash uniqueness/reuse policy
5. notifications.recipient_id polymorphism
6. Email encryption
7. payment_method_enum NET_BANKING/EMI
8. audit_log/notifications final column shapes
9. notification_type_enum — confirm all 9 for MVP
