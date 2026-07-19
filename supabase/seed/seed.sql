-- PERFECCITY MVP — Seed Data
-- Source of truth: Engineering Handover v7.0, Part 11
--
-- Sprint 1 launch seed: Users (5), Pricing Settings (3),
-- SKU Master (minimum viable, all ACTIVE), Design Templates (3, PUBLISHED).
-- Leads start at status=NEW so WF-2 can be exercised from clean state.
--
-- NOTE: Password hashes below are bcrypt of 'Password123!' for dev/testing only.
-- Production credentials must never be seeded this way.

-- ============================================================
-- USERS (5 roles)
-- ============================================================

INSERT INTO users (user_id, email, password_hash, role, status, full_name, mobile, department, created_at, updated_at)
VALUES
  -- Admin
  ('a0000000-0000-0000-0000-000000000001', 'admin@perfeccity.in',
   '$2b$10$EIXvYkPIhesn.q4ENwY/auIz3RzPp.f6YABsv0f1c.tGQWOVe5qXy',
   'ADMIN', 'ACTIVE', 'Platform Admin', '+919900000001', 'Operations',
   now(), now()),

  -- Manager
  ('a0000000-0000-0000-0000-000000000002', 'manager@perfeccity.in',
   '$2b$10$EIXvYkPIhesn.q4ENwY/auIz3RzPp.f6YABsv0f1c.tGQWOVe5qXy',
   'MANAGER', 'ACTIVE', 'Amit Patel', '+919900000002', 'Sales Management',
   now(), now()),

  -- Design Consultant
  ('a0000000-0000-0000-0000-000000000003', 'consultant@perfeccity.in',
   '$2b$10$EIXvYkPIhesn.q4ENwY/auIz3RzPp.f6YABsv0f1c.tGQWOVe5qXy',
   'SALESPERSON', 'ACTIVE', 'Rohan Sharma', '+919900000003', 'Design Consultation',
   now(), now()),

  -- Designer
  ('a0000000-0000-0000-0000-000000000004', 'designer@perfeccity.in',
   '$2b$10$EIXvYkPIhesn.q4ENwY/auIz3RzPp.f6YABsv0f1c.tGQWOVe5qXy',
   'DESIGNER', 'ACTIVE', 'Priya Nair', '+919900000004', 'Design Studio',
   now(), now()),

  -- Second Consultant (for testing assignment distribution)
  ('a0000000-0000-0000-0000-000000000005', 'consultant2@perfeccity.in',
   '$2b$10$EIXvYkPIhesn.q4ENwY/auIz3RzPp.f6YABsv0f1c.tGQWOVe5qXy',
   'SALESPERSON', 'ACTIVE', 'Sneha Kapoor', '+919900000005', 'Design Consultation',
   now(), now());

-- ============================================================
-- PRICING SETTINGS (3 — Part 11)
-- ============================================================

INSERT INTO pricing_settings (key, value_paise, description, updated_by, updated_at)
VALUES
  ('LABOUR_DIRECT_PAISE_PER_SQM', 15000,
   'Labour cost for DIRECT installation type — Rs 150/sqm',
   'a0000000-0000-0000-0000-000000000001', now()),

  ('LABOUR_FRAME_PAISE_PER_SQM', 25000,
   'Labour cost for FRAME_BASED installation type — Rs 250/sqm',
   'a0000000-0000-0000-0000-000000000001', now()),

  ('TRANSPORT_FLAT_RATE_PAISE', 500000,
   'Transport flat rate per project — Rs 5,000',
   'a0000000-0000-0000-0000-000000000001', now());

-- ============================================================
-- PRODUCT LIBRARY — SKU Master (minimum viable, all ACTIVE)
-- ============================================================

-- WALL_PANEL (4 — one per material family)
-- v7.0: dimensions seeded as numeric fields; dimensions varchar is display-only
INSERT INTO product_library (sku, category, name, unit, unit_cost_paise, sell_price_paise, material_family, width_mm, height_mm, thickness_mm, dimensions, is_active, status, created_by, created_at, updated_at)
VALUES
  ('WLP-WPC-CLS-OAK-001', 'WALL_PANEL', 'Classic WPC Oak Panel', 'pc',
   32000, 42000, 'WPC', 200, 2700, 9,
   '200×2700×9mm', TRUE, 'ACTIVE',
   'a0000000-0000-0000-0000-000000000001', now(), now()),

  ('WLP-PVC-STD-WHT-001', 'WALL_PANEL', 'Standard PVC White Panel', 'pc',
   18000, 24000, 'PVC', 200, 2700, 8,
   '200×2700×8mm', TRUE, 'ACTIVE',
   'a0000000-0000-0000-0000-000000000001', now(), now()),

  ('WLP-BCH-CLS-CHR-001', 'WALL_PANEL', 'Bamboo Charcoal Classic Panel', 'pc',
   28000, 36000, 'BAMBOO_CHARCOAL', 200, 2700, 9,
   '200×2700×9mm', TRUE, 'ACTIVE',
   'a0000000-0000-0000-0000-000000000001', now(), now()),

  ('WLP-UVM-MRB-WHT-001', 'WALL_PANEL', 'UV Marble White Stone Panel', 'pc',
   55000, 72000, 'UV_MARBLE', 600, 1200, 5,
   '600×1200×5mm', TRUE, 'ACTIVE',
   'a0000000-0000-0000-0000-000000000001', now(), now());

-- FURNITURE (15 fixed catalogue SKUs — all HDHMR, handleless, soft-close)
INSERT INTO product_library (sku, category, name, unit, unit_cost_paise, sell_price_paise, furniture_category, is_active, status, created_by, created_at, updated_at)
VALUES
  -- TV Console (3)
  ('FRN-TVC-LINE-001', 'FURNITURE', 'Line Console', 'pc', 1200000, 1560000, 'TV_CONSOLE', TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now()),
  ('FRN-TVC-PURE-001', 'FURNITURE', 'Pure Console', 'pc', 1400000, 1820000, 'TV_CONSOLE', TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now()),
  ('FRN-TVC-FLOAT-001', 'FURNITURE', 'Float Console', 'pc', 1100000, 1430000, 'TV_CONSOLE', TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now()),

  -- Shelf (4)
  ('FRN-SHF-CUBE-001', 'FURNITURE', 'Cube Shelf', 'pc', 350000, 455000, 'SHELF', TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now()),
  ('FRN-SHF-CURVE-001', 'FURNITURE', 'Curve Shelf', 'pc', 400000, 520000, 'SHELF', TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now()),
  ('FRN-SHF-BOX-001', 'FURNITURE', 'Box Shelf', 'pc', 380000, 494000, 'SHELF', TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now()),
  ('FRN-SHF-FLOAT-001', 'FURNITURE', 'Float Shelf', 'pc', 320000, 416000, 'SHELF', TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now()),

  -- Cabinet (6)
  ('FRN-CAB-VAULT-001', 'FURNITURE', 'Vault Cabinet', 'pc', 1800000, 2340000, 'CABINET', TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now()),
  ('FRN-CAB-STUDIO-001', 'FURNITURE', 'Studio Cabinet', 'pc', 2000000, 2600000, 'CABINET', TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now()),
  ('FRN-CAB-NOOK-001', 'FURNITURE', 'Nook Cabinet', 'pc', 1500000, 1950000, 'CABINET', TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now()),
  ('FRN-CAB-TOP-001', 'FURNITURE', 'Top Cabinet', 'pc', 900000, 1170000, 'CABINET', TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now()),
  ('FRN-CAB-SIDE-001', 'FURNITURE', 'Side Cabinet', 'pc', 1000000, 1300000, 'CABINET', TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now()),

  -- Mandir (1)
  ('FRN-MND-DIVINE-001', 'FURNITURE', 'Divine Back Panel', 'pc', 800000, 1040000, 'MANDIR', TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now()),

  -- Study (2)
  ('FRN-STD-FLOW-001', 'FURNITURE', 'Flow Desk', 'pc', 1300000, 1690000, 'STUDY_UNIT', TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now()),
  ('FRN-STD-TASK-001', 'FURNITURE', 'Task Desk', 'pc', 1100000, 1430000, 'STUDY_UNIT', TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now());

-- TRIM (3 — per panel colour)
INSERT INTO product_library (sku, category, name, unit, unit_cost_paise, sell_price_paise, is_active, status, created_by, created_at, updated_at)
VALUES
  ('TRM-WHT-SGP-001', 'TRIM', 'White Starter/Grid Profile', 'rft', 4500, 5850, TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now()),
  ('TRM-OAK-SGP-001', 'TRIM', 'Oak Starter/Grid Profile', 'rft', 4800, 6240, TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now()),
  ('TRM-CHR-SGP-001', 'TRIM', 'Charcoal Starter/Grid Profile', 'rft', 5000, 6500, TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now());

-- LIGHTING (2)
INSERT INTO product_library (sku, category, name, unit, unit_cost_paise, sell_price_paise, is_active, status, created_by, created_at, updated_at)
VALUES
  ('LGT-WRM-CLK-001', 'LIGHTING', 'Cove Light Kit (Warm White)', 'pc', 350000, 455000, TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now()),
  ('LGT-WRM-PLK-001', 'LIGHTING', 'Profile Light Kit (Warm White)', 'pc', 280000, 364000, TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now());

-- CONSUMABLE (3)
INSERT INTO product_library (sku, category, name, unit, unit_cost_paise, sell_price_paise, is_active, status, created_by, created_at, updated_at)
VALUES
  ('CSM-ADH-PNL-001', 'CONSUMABLE', 'Panel Adhesive', 'unit', 12000, 15600, TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now()),
  ('CSM-PVC-BSB-001', 'CONSUMABLE', 'Base Board 10mm (PVC)', 'sqm', 8500, 11050, TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now()),
  ('CSM-PVC-BCK-001', 'CONSUMABLE', 'Moisture Backing 5mm', 'sqm', 6500, 8450, TRUE, 'ACTIVE', 'a0000000-0000-0000-0000-000000000001', now(), now());

-- ============================================================
-- DESIGN TEMPLATES (3 — PUBLISHED, with tolerance fields populated)
-- ============================================================

INSERT INTO design_templates (
  template_id, collection, space_type, template_name, theme, tags,
  price_range, template_type, wall_shape,
  default_wall_width_mm, default_wall_height_mm,
  min_width_mm, max_width_mm, min_height_mm, max_height_mm,
  wall_type, installation_type, compatible_materials, compatible_spaces,
  status, created_by, published_at, created_at, updated_at
)
VALUES
  -- 1. Nordic Shadow
  ('b0000000-0000-0000-0000-000000000001',
   'NORDIC_SERIES', 'TV_UNIT_WALL', 'Nordic Shadow',
   'Scandinavian minimalism with warm oak tones',
   ARRAY['nordic', 'oak', 'cove-light', 'minimal'],
   'PREMIUM', 'WALL_PANEL_WITH_LIGHTING', 'STRAIGHT',
   2400, 2700, 1800, 3600, 2400, 3300,
   'BRICK', 'FRAME_BASED',
   ARRAY['WPC', 'PVC']::material_preference_enum[],
   ARRAY['TV_UNIT_WALL', 'BED_BACK_WALL', 'LIVING_ROOM_FEATURE_WALL']::space_type_enum[],
   'PUBLISHED', 'a0000000-0000-0000-0000-000000000004', now(), now(), now()),

  -- 2. Pure White Minimal
  ('b0000000-0000-0000-0000-000000000002',
   'MODERN_MINIMAL', 'LIVING_ROOM_FEATURE_WALL', 'Pure White Minimal',
   'Clean lines, profile lighting, PVC economy',
   ARRAY['white', 'minimal', 'profile-light', 'budget-friendly'],
   'STANDARD', 'WALL_PANEL_WITH_LIGHTING', 'STRAIGHT',
   2400, 2700, 1500, 4000, 2400, 3300,
   'DRYWALL', 'FRAME_BASED',
   ARRAY['PVC']::material_preference_enum[],
   ARRAY['TV_UNIT_WALL', 'LIVING_ROOM_FEATURE_WALL', 'BED_BACK_WALL', 'HOME_ENTRANCE', 'MANDIR_CORNER', 'STUDY_WALL', 'PHOTO_WALL', 'BATHROOM_WALL', 'DINING_WALL', 'VANITY_CORNER', 'KIDS_ROOM_WALL', 'CUSTOM_SPACE']::space_type_enum[],
   'PUBLISHED', 'a0000000-0000-0000-0000-000000000004', now(), now(), now()),

  -- 3. Bamboo Classic Dark
  ('b0000000-0000-0000-0000-000000000003',
   'URBAN_CHARCOAL', 'BED_BACK_WALL', 'Bamboo Classic Dark',
   'Deep charcoal bamboo with cove lighting accent',
   ARRAY['bamboo', 'charcoal', 'dark', 'cove-light', 'premium'],
   'LUXURY', 'WALL_PANEL_WITH_LIGHTING', 'STRAIGHT',
   3000, 2700, 2000, 4000, 2400, 3300,
   'RCC', 'FRAME_BASED',
   ARRAY['BAMBOO_CHARCOAL']::material_preference_enum[],
   ARRAY['TV_UNIT_WALL', 'BED_BACK_WALL', 'LIVING_ROOM_FEATURE_WALL']::space_type_enum[],
   'PUBLISHED', 'a0000000-0000-0000-0000-000000000004', now(), now(), now());

-- ============================================================
-- DESIGN ELEMENTS for seeded templates (minimum viable BOM structure)
-- ============================================================

-- Nordic Shadow: WPC Oak panel (PRIMARY) + Cove Light + Oak Trim
INSERT INTO design_elements (template_id, sku, product_role, default_quantity, colour_variant, finish_variant, default_position)
VALUES
  ('b0000000-0000-0000-0000-000000000001', 'WLP-WPC-CLS-OAK-001', 'PRIMARY', 1, 'Oak', 'WOOD_GRAIN', NULL),
  ('b0000000-0000-0000-0000-000000000001', 'LGT-WRM-CLK-001', 'LIGHTING', 1, NULL, NULL, 'TOP'),
  ('b0000000-0000-0000-0000-000000000001', 'TRM-OAK-SGP-001', 'TRIM', 1, 'Oak', NULL, NULL);

-- Pure White Minimal: PVC White panel (PRIMARY) + Profile Light + White Trim
INSERT INTO design_elements (template_id, sku, product_role, default_quantity, colour_variant, finish_variant, default_position)
VALUES
  ('b0000000-0000-0000-0000-000000000002', 'WLP-PVC-STD-WHT-001', 'PRIMARY', 1, 'White', 'MATTE', NULL),
  ('b0000000-0000-0000-0000-000000000002', 'LGT-WRM-PLK-001', 'LIGHTING', 1, NULL, NULL, 'TOP'),
  ('b0000000-0000-0000-0000-000000000002', 'TRM-WHT-SGP-001', 'TRIM', 1, 'White', NULL, NULL);

-- Bamboo Classic Dark: Bamboo Charcoal panel (PRIMARY) + Cove Light + Charcoal Trim
INSERT INTO design_elements (template_id, sku, product_role, default_quantity, colour_variant, finish_variant, default_position)
VALUES
  ('b0000000-0000-0000-0000-000000000003', 'WLP-BCH-CLS-CHR-001', 'PRIMARY', 1, 'Charcoal', 'TEXTURED', NULL),
  ('b0000000-0000-0000-0000-000000000003', 'LGT-WRM-CLK-001', 'LIGHTING', 1, NULL, NULL, 'TOP'),
  ('b0000000-0000-0000-0000-000000000003', 'TRM-CHR-SGP-001', 'TRIM', 1, 'Charcoal', NULL, NULL);

-- ============================================================
-- TEMPLATE CONSUMABLES (auto-added by Configuration Engine R6/R7)
-- ============================================================

-- All FRAME_BASED templates need base board (condition: installation_type = FRAME_BASED)
INSERT INTO template_consumables (template_id, sku, quantity_formula, condition_field, condition_value)
VALUES
  ('b0000000-0000-0000-0000-000000000001', 'CSM-PVC-BSB-001', 'PER_SQM', 'installation_type', 'FRAME_BASED'),
  ('b0000000-0000-0000-0000-000000000002', 'CSM-PVC-BSB-001', 'PER_SQM', 'installation_type', 'FRAME_BASED'),
  ('b0000000-0000-0000-0000-000000000003', 'CSM-PVC-BSB-001', 'PER_SQM', 'installation_type', 'FRAME_BASED');

-- All templates need adhesive
INSERT INTO template_consumables (template_id, sku, quantity_formula, condition_field, condition_value)
VALUES
  ('b0000000-0000-0000-0000-000000000001', 'CSM-ADH-PNL-001', 'PER_SQM', NULL, NULL),
  ('b0000000-0000-0000-0000-000000000002', 'CSM-ADH-PNL-001', 'PER_SQM', NULL, NULL),
  ('b0000000-0000-0000-0000-000000000003', 'CSM-ADH-PNL-001', 'PER_SQM', NULL, NULL);

-- Moisture backing for HIGH moisture spaces
INSERT INTO template_consumables (template_id, sku, quantity_formula, condition_field, condition_value)
VALUES
  ('b0000000-0000-0000-0000-000000000001', 'CSM-PVC-BCK-001', 'PER_SQM', 'moisture_level', 'HIGH'),
  ('b0000000-0000-0000-0000-000000000002', 'CSM-PVC-BCK-001', 'PER_SQM', 'moisture_level', 'HIGH'),
  ('b0000000-0000-0000-0000-000000000003', 'CSM-PVC-BCK-001', 'PER_SQM', 'moisture_level', 'HIGH');

-- ============================================================
-- DIGITAL ASSETS (placeholder GLB references — actual files in Storage)
-- ============================================================

INSERT INTO digital_assets (template_id, asset_type, s3_key, is_active, uploaded_by, uploaded_at)
VALUES
  ('b0000000-0000-0000-0000-000000000001', 'GLB', 'templates/nordic-shadow/scene.glb', TRUE, 'a0000000-0000-0000-0000-000000000004', now()),
  ('b0000000-0000-0000-0000-000000000001', 'RENDER', 'templates/nordic-shadow/thumbnail.jpg', TRUE, 'a0000000-0000-0000-0000-000000000004', now()),
  ('b0000000-0000-0000-0000-000000000002', 'GLB', 'templates/pure-white-minimal/scene.glb', TRUE, 'a0000000-0000-0000-0000-000000000004', now()),
  ('b0000000-0000-0000-0000-000000000002', 'RENDER', 'templates/pure-white-minimal/thumbnail.jpg', TRUE, 'a0000000-0000-0000-0000-000000000004', now()),
  ('b0000000-0000-0000-0000-000000000003', 'GLB', 'templates/bamboo-classic-dark/scene.glb', TRUE, 'a0000000-0000-0000-0000-000000000004', now()),
  ('b0000000-0000-0000-0000-000000000003', 'RENDER', 'templates/bamboo-classic-dark/thumbnail.jpg', TRUE, 'a0000000-0000-0000-0000-000000000004', now());

-- ============================================================
-- LEADS (3 — at status=NEW for WF-2 testing)
-- ============================================================

INSERT INTO leads (
  customer_name, mobile_encrypted, mobile_hash, email_address,
  project_address, city, project_type, lead_source, status,
  created_by, created_at, updated_at
)
VALUES
  ('Rahul Verma',
   E'\\x' || encode(convert_to('+919876543210', 'UTF8'), 'hex'),
   encode(sha256(convert_to('+919876543210', 'UTF8')), 'hex'),
   'rahul.verma@example.com',
   '42 Park Avenue, Bandra West', 'Mumbai', 'RESIDENTIAL', 'WALK_IN', 'NEW',
   'a0000000-0000-0000-0000-000000000001', now(), now()),

  ('Meera Krishnan',
   E'\\x' || encode(convert_to('+919876543211', 'UTF8'), 'hex'),
   encode(sha256(convert_to('+919876543211', 'UTF8')), 'hex'),
   'meera.k@example.com',
   '15 MG Road, Indiranagar', 'Bangalore', 'RESIDENTIAL', 'REFERRAL', 'NEW',
   'a0000000-0000-0000-0000-000000000001', now(), now()),

  ('Arjun Mehta',
   E'\\x' || encode(convert_to('+919876543212', 'UTF8'), 'hex'),
   encode(sha256(convert_to('+919876543212', 'UTF8')), 'hex'),
   'arjun.mehta@example.com',
   '8 Jubilee Hills, Road No 36', 'Hyderabad', 'COMMERCIAL', 'EXHIBITION', 'NEW',
   'a0000000-0000-0000-0000-000000000001', now(), now());
