/**
 * PERFECCITY MVP — Shared Enumerations
 * Source of truth: Engineering Handover v7.0, Part 6
 * 
 * These TypeScript enums mirror the Postgres CREATE TYPE definitions
 * in supabase/migrations/. They exist for type-safe usage in application
 * code without runtime DB queries.
 */

// Domain 1 — Authentication & Identity
export const UserRole = {
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  SALESPERSON: 'SALESPERSON',
  DESIGNER: 'DESIGNER',
  CUSTOMER: 'CUSTOMER',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserStatus = {
  PENDING_SETUP: 'PENDING_SETUP',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

// Domain 2 — Lead & Acquisition
export const LeadStatus = {
  NEW: 'NEW',
  ASSIGNED: 'ASSIGNED',
  CONTACTED: 'CONTACTED',
  SCHEDULED: 'SCHEDULED',
  SURVEY_COMPLETED: 'SURVEY_COMPLETED',
  CONVERTED: 'CONVERTED',
  LOST: 'LOST',
} as const;
export type LeadStatus = (typeof LeadStatus)[keyof typeof LeadStatus];

export const LeadSource = {
  WEB: 'WEB',
  WALK_IN: 'WALK_IN',
  REFERRAL: 'REFERRAL',
  EXHIBITION: 'EXHIBITION',
  DIRECT_CALL: 'DIRECT_CALL',
  SOCIAL_MEDIA: 'SOCIAL_MEDIA',
} as const;
export type LeadSource = (typeof LeadSource)[keyof typeof LeadSource];

export const LostReason = {
  BUDGET_MISMATCH: 'BUDGET_MISMATCH',
  COMPETITOR_CHOSEN: 'COMPETITOR_CHOSEN',
  PROJECT_CANCELLED: 'PROJECT_CANCELLED',
  NO_RESPONSE: 'NO_RESPONSE',
  TIMELINE_MISMATCH: 'TIMELINE_MISMATCH',
  OTHER: 'OTHER',
} as const;
export type LostReason = (typeof LostReason)[keyof typeof LostReason];

// Domain 3 — Project & Workflow Core
export const ProjectStatus = {
  PROJECT_CREATED: 'PROJECT_CREATED',
  CONFIGURING: 'CONFIGURING',
  REVIEWED: 'REVIEWED',
  QUOTED: 'QUOTED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  APPROVED: 'APPROVED',
  ORDERED: 'ORDERED',
  IN_PRODUCTION: 'IN_PRODUCTION',
  INSTALLATION_SCHEDULED: 'INSTALLATION_SCHEDULED',
  CLOSED: 'CLOSED',
} as const;
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export const ProjectType = {
  RESIDENTIAL: 'RESIDENTIAL',
  COMMERCIAL: 'COMMERCIAL',
} as const;
export type ProjectType = (typeof ProjectType)[keyof typeof ProjectType];

export const StageStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
} as const;
export type StageStatus = (typeof StageStatus)[keyof typeof StageStatus];

// Domain 4 — Consultation Discovery
export const BudgetTier = {
  STANDARD: 'STANDARD',
  PREMIUM: 'PREMIUM',
  LUXURY: 'LUXURY',
} as const;
export type BudgetTier = (typeof BudgetTier)[keyof typeof BudgetTier];

export const SpaceType = {
  TV_UNIT_WALL: 'TV_UNIT_WALL',
  LIVING_ROOM_FEATURE_WALL: 'LIVING_ROOM_FEATURE_WALL',
  BED_BACK_WALL: 'BED_BACK_WALL',
  HOME_ENTRANCE: 'HOME_ENTRANCE',
  MANDIR_CORNER: 'MANDIR_CORNER',
  STUDY_WALL: 'STUDY_WALL',
  PHOTO_WALL: 'PHOTO_WALL',
  BATHROOM_WALL: 'BATHROOM_WALL',
  DINING_WALL: 'DINING_WALL',
  VANITY_CORNER: 'VANITY_CORNER',
  KIDS_ROOM_WALL: 'KIDS_ROOM_WALL',
  CUSTOM_SPACE: 'CUSTOM_SPACE',
} as const;
export type SpaceType = (typeof SpaceType)[keyof typeof SpaceType];

export const WallShape = {
  STRAIGHT: 'STRAIGHT',
  L_SHAPE: 'L_SHAPE',
  C_SHAPE: 'C_SHAPE',
} as const;
export type WallShape = (typeof WallShape)[keyof typeof WallShape];

export const WallType = {
  BRICK: 'BRICK',
  DRYWALL: 'DRYWALL',
  RCC: 'RCC',
} as const;
export type WallType = (typeof WallType)[keyof typeof WallType];

export const MoistureLevel = {
  DRY: 'DRY',
  AMBIENT: 'AMBIENT',
  HIGH: 'HIGH',
} as const;
export type MoistureLevel = (typeof MoistureLevel)[keyof typeof MoistureLevel];

export const MaterialPreference = {
  PVC: 'PVC',
  WPC: 'WPC',
  BAMBOO_CHARCOAL: 'BAMBOO_CHARCOAL',
  UV_MARBLE: 'UV_MARBLE',
} as const;
export type MaterialPreference = (typeof MaterialPreference)[keyof typeof MaterialPreference];

export const DesignStyle = {
  MODERN: 'MODERN',
  CONTEMPORARY: 'CONTEMPORARY',
  MINIMAL: 'MINIMAL',
  LUXURY: 'LUXURY',
  SCANDINAVIAN: 'SCANDINAVIAN',
  INDUSTRIAL: 'INDUSTRIAL',
  CLASSIC: 'CLASSIC',
} as const;
export type DesignStyle = (typeof DesignStyle)[keyof typeof DesignStyle];

export const ColourPalette = {
  WHITE: 'WHITE',
  GREY: 'GREY',
  BEIGE: 'BEIGE',
  BLACK: 'BLACK',
  WALNUT: 'WALNUT',
  OAK: 'OAK',
  MARBLE: 'MARBLE',
  CUSTOM: 'CUSTOM',
} as const;
export type ColourPalette = (typeof ColourPalette)[keyof typeof ColourPalette];

export const FinishPreference = {
  MATTE: 'MATTE',
  GLOSS: 'GLOSS',
  TEXTURED: 'TEXTURED',
  WOOD_GRAIN: 'WOOD_GRAIN',
  STONE_FINISH: 'STONE_FINISH',
} as const;
export type FinishPreference = (typeof FinishPreference)[keyof typeof FinishPreference];

export const LightingPreference = {
  WARM_WHITE: 'WARM_WHITE',
  NEUTRAL_WHITE: 'NEUTRAL_WHITE',
  COOL_WHITE: 'COOL_WHITE',
  COVE_LIGHTING: 'COVE_LIGHTING',
  LINEAR_LED: 'LINEAR_LED',
  NO_LIGHTING: 'NO_LIGHTING',
} as const;
export type LightingPreference = (typeof LightingPreference)[keyof typeof LightingPreference];

export const LightingType = {
  NONE: 'NONE',
  PROFILE_LIGHT: 'PROFILE_LIGHT',
  COVE_LIGHT: 'COVE_LIGHT',
} as const;
export type LightingType = (typeof LightingType)[keyof typeof LightingType];

// Domain 5 — Space & Design Configuration
export const InstallationType = {
  DIRECT: 'DIRECT',
  FRAME_BASED: 'FRAME_BASED',
} as const;
export type InstallationType = (typeof InstallationType)[keyof typeof InstallationType];

// Domain 6 — Design Template Library
export const TemplateStatus = {
  DRAFT: 'DRAFT',
  READY_FOR_REVIEW: 'READY_FOR_REVIEW',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type TemplateStatus = (typeof TemplateStatus)[keyof typeof TemplateStatus];

export const DesignCollection = {
  NORDIC_SERIES: 'NORDIC_SERIES',
  INDUSTRIAL_LOFT: 'INDUSTRIAL_LOFT',
  MODERN_MINIMAL: 'MODERN_MINIMAL',
  HERITAGE_CLASSIC: 'HERITAGE_CLASSIC',
  URBAN_CHARCOAL: 'URBAN_CHARCOAL',
} as const;
export type DesignCollection = (typeof DesignCollection)[keyof typeof DesignCollection];

export const TemplateType = {
  WALL_PANEL_ONLY: 'WALL_PANEL_ONLY',
  WALL_PANEL_WITH_LIGHTING: 'WALL_PANEL_WITH_LIGHTING',
} as const;
export type TemplateType = (typeof TemplateType)[keyof typeof TemplateType];

export const ProductRole = {
  PRIMARY: 'PRIMARY',
  SECONDARY: 'SECONDARY',
  TRIM: 'TRIM',
  LIGHTING: 'LIGHTING',
  CONSUMABLE: 'CONSUMABLE',
} as const;
export type ProductRole = (typeof ProductRole)[keyof typeof ProductRole];

// Domain 7 — SKU & Pricing Master
export const SkuCategory = {
  WALL_PANEL: 'WALL_PANEL',
  FURNITURE: 'FURNITURE',
  TRIM: 'TRIM',
  LIGHTING: 'LIGHTING',
  CONSUMABLE: 'CONSUMABLE',
} as const;
export type SkuCategory = (typeof SkuCategory)[keyof typeof SkuCategory];

export const FurnitureCategory = {
  TV_CONSOLE: 'TV_CONSOLE',
  SHELF: 'SHELF',
  CABINET: 'CABINET',
  MANDIR: 'MANDIR',
  STUDY_UNIT: 'STUDY_UNIT',
} as const;
export type FurnitureCategory = (typeof FurnitureCategory)[keyof typeof FurnitureCategory];

export const ProductStatus = {
  PROPOSED: 'PROPOSED',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  REJECTED: 'REJECTED',
} as const;
export type ProductStatus = (typeof ProductStatus)[keyof typeof ProductStatus];

// Domain 8 — Quotation & Commercial
export const SnapshotStatus = {
  DRAFT: 'DRAFT',
  SEALED: 'SEALED',
  EXPIRED: 'EXPIRED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type SnapshotStatus = (typeof SnapshotStatus)[keyof typeof SnapshotStatus];

export const AdvancePaymentStatus = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  REFUNDED: 'REFUNDED',
} as const;
export type AdvancePaymentStatus = (typeof AdvancePaymentStatus)[keyof typeof AdvancePaymentStatus];

export const PaymentMethod = {
  CASH: 'CASH',
  BANK_TRANSFER: 'BANK_TRANSFER',
  UPI: 'UPI',
  CHEQUE: 'CHEQUE',
  CARD: 'CARD',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const BomSource = {
  WALL_PANEL: 'WALL_PANEL',
  FURNITURE: 'FURNITURE',
  TRIM: 'TRIM',
  LIGHTING: 'LIGHTING',
  CONSUMABLE: 'CONSUMABLE',
} as const;
export type BomSource = (typeof BomSource)[keyof typeof BomSource];

export const ReviewResult = {
  PASS: 'PASS',
  FAIL: 'FAIL',
} as const;
export type ReviewResult = (typeof ReviewResult)[keyof typeof ReviewResult];

// Domain 9 — Manufacturing & Fulfilment
export const MfgPackageStatus = {
  GENERATING: 'GENERATING',
  READY: 'READY',
  FAILED: 'FAILED',
} as const;
export type MfgPackageStatus = (typeof MfgPackageStatus)[keyof typeof MfgPackageStatus];

export const InstallationSlot = {
  MORNING: 'MORNING',
  AFTERNOON: 'AFTERNOON',
} as const;
export type InstallationSlot = (typeof InstallationSlot)[keyof typeof InstallationSlot];

export const InstallationScheduleStatus = {
  CONFIRMED: 'CONFIRMED',
  RESCHEDULE_REQUESTED: 'RESCHEDULE_REQUESTED',
  RESCHEDULED: 'RESCHEDULED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
} as const;
export type InstallationScheduleStatus = (typeof InstallationScheduleStatus)[keyof typeof InstallationScheduleStatus];

export const RescheduleActor = {
  CUSTOMER: 'CUSTOMER',
  MANAGER: 'MANAGER',
  ADMIN: 'ADMIN',
} as const;
export type RescheduleActor = (typeof RescheduleActor)[keyof typeof RescheduleActor];

// Domain 10 — Customer Portal Identity
export const CustomerStatus = {
  INVITED: 'INVITED',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type CustomerStatus = (typeof CustomerStatus)[keyof typeof CustomerStatus];

// Domain 11 — Platform Services
export const NotificationType = {
  LEAD_ASSIGNED: 'LEAD_ASSIGNED',
  INSTALLATION_SCHEDULED: 'INSTALLATION_SCHEDULED',
  RESCHEDULE_REQUESTED: 'RESCHEDULE_REQUESTED',
  RESCHEDULE_APPROVED: 'RESCHEDULE_APPROVED',
  RESCHEDULE_REJECTED: 'RESCHEDULE_REJECTED',
  SKU_REJECTED: 'SKU_REJECTED',
  TEMPLATE_SUBMITTED_FOR_REVIEW: 'TEMPLATE_SUBMITTED_FOR_REVIEW',
  TEMPLATE_CHANGES_REQUESTED: 'TEMPLATE_CHANGES_REQUESTED',
  APPROVAL_CONFIRMATION: 'APPROVAL_CONFIRMATION',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

// Asset types
export const AssetType = {
  GLB: 'GLB',
  RENDER: 'RENDER',
  TEXTURE: 'TEXTURE',
  METADATA: 'METADATA',
} as const;
export type AssetType = (typeof AssetType)[keyof typeof AssetType];
