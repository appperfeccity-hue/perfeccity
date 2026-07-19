-- PERFECCITY MVP — Migration 00001: Create all enumerations
-- Source of truth: Engineering Handover v7.0, Part 6
-- 
-- Migration policy (Part 5, frozen):
-- - Enum values are append-only after Sprint 1
-- - Existing values are never removed or renamed
-- - Any addition gets a new versioned migration file
--
-- Total: 37 CREATE TYPE statements

-- ============================================================
-- Domain 1 — Authentication & Identity
-- ============================================================

CREATE TYPE user_role_enum AS ENUM (
  'ADMIN',
  'MANAGER',
  'SALESPERSON',
  'DESIGNER',
  'CUSTOMER'
);

CREATE TYPE user_status_enum AS ENUM (
  'PENDING_SETUP',
  'ACTIVE',
  'INACTIVE'
);

-- ============================================================
-- Domain 2 — Lead & Acquisition
-- ============================================================

CREATE TYPE lead_status_enum AS ENUM (
  'NEW',
  'ASSIGNED',
  'CONTACTED',
  'SCHEDULED',
  'SURVEY_COMPLETED',
  'CONVERTED',
  'LOST'
);

CREATE TYPE lead_source_enum AS ENUM (
  'WEB',
  'WALK_IN',
  'REFERRAL',
  'EXHIBITION',
  'DIRECT_CALL',
  'SOCIAL_MEDIA'
);

CREATE TYPE lost_reason_enum AS ENUM (
  'BUDGET_MISMATCH',
  'COMPETITOR_CHOSEN',
  'PROJECT_CANCELLED',
  'NO_RESPONSE',
  'TIMELINE_MISMATCH',
  'OTHER'
);

-- ============================================================
-- Domain 3 — Project & Workflow Core
-- ============================================================

CREATE TYPE project_status_enum AS ENUM (
  'PROJECT_CREATED',
  'CONFIGURING',
  'REVIEWED',
  'QUOTED',
  'PAYMENT_PENDING',
  'APPROVED',
  'ORDERED',
  'IN_PRODUCTION',
  'INSTALLATION_SCHEDULED',
  'CLOSED'
);
-- 10 values, final. ORDERED→IN_PRODUCTION→INSTALLATION_SCHEDULED→CLOSED
-- cover all post-payment progress.

CREATE TYPE project_type_enum AS ENUM (
  'RESIDENTIAL',
  'COMMERCIAL'
);

CREATE TYPE stage_status_enum AS ENUM (
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED'
);

-- ============================================================
-- Domain 4 — Consultation Discovery
-- ============================================================

CREATE TYPE budget_tier_enum AS ENUM (
  'STANDARD',
  'PREMIUM',
  'LUXURY'
);
-- UI displays "Elegant/Premium/Luxury"; display-label mapping only, values unchanged.

CREATE TYPE space_type_enum AS ENUM (
  'TV_UNIT_WALL',
  'LIVING_ROOM_FEATURE_WALL',
  'BED_BACK_WALL',
  'HOME_ENTRANCE',
  'MANDIR_CORNER',
  'STUDY_WALL',
  'PHOTO_WALL',
  'BATHROOM_WALL',
  'DINING_WALL',
  'VANITY_CORNER',
  'KIDS_ROOM_WALL',
  'CUSTOM_SPACE'
);
-- Exactly 12 valid values. Reject: TV_WALL, BEDROOM_WALL, WARDROBE, KITCHEN,
-- POOJA_WALL, STAIRCASE_WALL, BALCONY_WALL (app-layer validation, not enum members).

CREATE TYPE wall_shape_enum AS ENUM (
  'STRAIGHT',
  'L_SHAPE',
  'C_SHAPE'
);

CREATE TYPE wall_type_enum AS ENUM (
  'BRICK',
  'DRYWALL',
  'RCC'
);

CREATE TYPE moisture_level_enum AS ENUM (
  'DRY',
  'AMBIENT',
  'HIGH'
);

CREATE TYPE material_preference_enum AS ENUM (
  'PVC',
  'WPC',
  'BAMBOO_CHARCOAL',
  'UV_MARBLE'
);
-- Never 'CHARCOAL' alone — invalid, rejected at app layer.

CREATE TYPE design_style_enum AS ENUM (
  'MODERN',
  'CONTEMPORARY',
  'MINIMAL',
  'LUXURY',
  'SCANDINAVIAN',
  'INDUSTRIAL',
  'CLASSIC'
);

CREATE TYPE colour_palette_enum AS ENUM (
  'WHITE',
  'GREY',
  'BEIGE',
  'BLACK',
  'WALNUT',
  'OAK',
  'MARBLE',
  'CUSTOM'
);

CREATE TYPE finish_preference_enum AS ENUM (
  'MATTE',
  'GLOSS',
  'TEXTURED',
  'WOOD_GRAIN',
  'STONE_FINISH'
);

CREATE TYPE lighting_preference_enum AS ENUM (
  'WARM_WHITE',
  'NEUTRAL_WHITE',
  'COOL_WHITE',
  'COVE_LIGHTING',
  'LINEAR_LED',
  'NO_LIGHTING'
);

CREATE TYPE lighting_type_enum AS ENUM (
  'NONE',
  'PROFILE_LIGHT',
  'COVE_LIGHT'
);

-- ============================================================
-- Domain 5 — Space & Design Configuration
-- ============================================================

CREATE TYPE installation_type_enum AS ENUM (
  'DIRECT',
  'FRAME_BASED'
);

-- ============================================================
-- Domain 6 — Design Template Library
-- ============================================================

CREATE TYPE template_status_enum AS ENUM (
  'DRAFT',
  'READY_FOR_REVIEW',
  'PUBLISHED',
  'ARCHIVED'
);

CREATE TYPE design_collection_enum AS ENUM (
  'NORDIC_SERIES',
  'INDUSTRIAL_LOFT',
  'MODERN_MINIMAL',
  'HERITAGE_CLASSIC',
  'URBAN_CHARCOAL'
);

CREATE TYPE template_type_enum AS ENUM (
  'WALL_PANEL_ONLY',
  'WALL_PANEL_WITH_LIGHTING'
);

CREATE TYPE product_role_enum AS ENUM (
  'PRIMARY',
  'SECONDARY',
  'TRIM',
  'LIGHTING',
  'CONSUMABLE'
);

-- ============================================================
-- Domain 7 — SKU & Pricing Master
-- ============================================================

CREATE TYPE sku_category_enum AS ENUM (
  'WALL_PANEL',
  'FURNITURE',
  'TRIM',
  'LIGHTING',
  'CONSUMABLE'
);

CREATE TYPE furniture_category_enum AS ENUM (
  'TV_CONSOLE',
  'SHELF',
  'CABINET',
  'MANDIR',
  'STUDY_UNIT'
);

CREATE TYPE product_status_enum AS ENUM (
  'PROPOSED',
  'ACTIVE',
  'INACTIVE',
  'REJECTED'
);

-- ============================================================
-- Domain 8 — Quotation & Commercial
-- ============================================================

CREATE TYPE snapshot_status_enum AS ENUM (
  'DRAFT',
  'SEALED',
  'EXPIRED',
  'ARCHIVED'
);

CREATE TYPE advance_payment_status_enum AS ENUM (
  'PENDING',
  'CONFIRMED',
  'REFUNDED'
);

CREATE TYPE payment_method_enum AS ENUM (
  'CASH',
  'BANK_TRANSFER',
  'UPI',
  'CHEQUE',
  'CARD'
);
-- NOTE (Part 15, item 7): NET_BANKING and EMI are referenced in narrative
-- but NOT in this frozen enum. Decision pending before Sprint 3.
-- If added, they follow the gateway webhook confirmation path (like UPI/CARD).

CREATE TYPE bom_source_enum AS ENUM (
  'WALL_PANEL',
  'FURNITURE',
  'TRIM',
  'LIGHTING',
  'CONSUMABLE'
);

CREATE TYPE review_result_enum AS ENUM (
  'PASS',
  'FAIL'
);

-- ============================================================
-- Domain 9 — Manufacturing & Fulfilment
-- ============================================================

CREATE TYPE mfg_package_status_enum AS ENUM (
  'GENERATING',
  'READY',
  'FAILED'
);

CREATE TYPE installation_slot_enum AS ENUM (
  'MORNING',
  'AFTERNOON'
);

CREATE TYPE installation_schedule_status_enum AS ENUM (
  'CONFIRMED',
  'RESCHEDULE_REQUESTED',
  'RESCHEDULED',
  'CANCELLED',
  'COMPLETED'
);

CREATE TYPE reschedule_actor_enum AS ENUM (
  'CUSTOMER',
  'MANAGER',
  'ADMIN'
);

-- ============================================================
-- Domain 10 — Customer Portal Identity
-- ============================================================

CREATE TYPE customer_status_enum AS ENUM (
  'INVITED',
  'ACTIVE',
  'SUSPENDED'
);

-- ============================================================
-- Domain 11 — Platform Services
-- ============================================================

CREATE TYPE notification_type_enum AS ENUM (
  'LEAD_ASSIGNED',
  'INSTALLATION_SCHEDULED',
  'RESCHEDULE_REQUESTED',
  'RESCHEDULE_APPROVED',
  'RESCHEDULE_REJECTED',
  'SKU_REJECTED',
  'TEMPLATE_SUBMITTED_FOR_REVIEW',
  'TEMPLATE_CHANGES_REQUESTED',
  'APPROVAL_CONFIRMATION'
);
-- v7.0 — every value traced to an actual trigger described in Part 4.
-- TODO (Part 15, item 9): Confirm all 9 are wanted for MVP before Sprint 1 build.

-- ============================================================
-- Asset types (used by digital_assets table)
-- ============================================================

CREATE TYPE asset_type_enum AS ENUM (
  'GLB',
  'RENDER',
  'TEXTURE',
  'METADATA'
);
