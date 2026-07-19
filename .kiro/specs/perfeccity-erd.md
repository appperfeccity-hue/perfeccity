# PERFECCITY MVP — Full Database ERD (v4)

> 36 tables / 11 domains — derived from Engineering Handover v7.0, Part 5
> See the full Mermaid ERD in the session-attached PERFECCITY-ERD.md document.

## Domain Summary

| # | Domain | Tables |
|---|---|---|
| 1 | Authentication & Identity | users, refresh_tokens, password_reset_tokens |
| 2 | Lead & Acquisition | leads, lead_activities |
| 3 | Project & Workflow Core | projects, project_state_history, consultation_stages |
| 4 | Consultation Discovery | lifestyle_assessments, budget_profiles, site_assessments, site_photographs, design_dna |
| 5 | Space & Design Configuration | application_spaces, space_design_overrides, space_measurements, space_configurations |
| 6 | Design Template Library | design_templates, design_elements, template_consumables, digital_assets |
| 7 | SKU & Pricing Master | product_library, pricing_settings |
| 8 | Quotation & Commercial | quotation_snapshots, bom_lines, configuration_line_items, configured_furniture, review_records, advance_payments |
| 9 | Manufacturing & Fulfilment | manufacturing_packages, installation_schedules, installation_reschedule_log |
| 10 | Customer Portal Identity | customer_accounts, customer_project_links |
| 11 | Platform Services | audit_log, notifications |

**Total: 36 tables**

## Key Constraints

- `one_primary_wall_per_project`: UNIQUE INDEX ON application_spaces(project_id) WHERE is_primary_wall = TRUE
- `one_active_package_per_project`: UNIQUE INDEX ON manufacturing_packages(project_id) WHERE status IN ('GENERATING','READY')
- `one_current_config_per_space`: UNIQUE INDEX ON space_configurations(space_id) WHERE is_current = TRUE
- `advance_payments.project_id`: UNIQUE (single-payment rule)
- `installation_schedules.project_id`: UNIQUE (single-schedule rule)
- `lifestyle_assessments.project_id`: UNIQUE (1:1)
- `budget_profiles.project_id`: UNIQUE (1:1)
- `site_assessments.project_id`: UNIQUE (1:1)
- `design_dna.project_id`: UNIQUE (1:1)
- `customer_accounts.lead_id`: UNIQUE (1:1)

## v7.0 Changes from v6.4

1. configured_furniture.config_id added (config-scoped traceability)
2. product_library split: width_mm, height_mm, thickness_mm numeric + dimensions display-only
3. one_current_config_per_space partial unique index added
4. notification_type_enum added (9 values from Part 4 triggers)
5. Table count corrected 37 → 36
6. price_group_enum, pdf_job_status_enum removed (orphaned)
