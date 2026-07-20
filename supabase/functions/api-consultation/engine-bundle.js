// packages/config-engine/src/formulas/area.ts
function computeGrossArea(wall_shape, width_mm, height_mm, segment_b_mm, segment_c_mm) {
  switch (wall_shape) {
    case "STRAIGHT":
      return width_mm * height_mm;
    case "L_SHAPE":
      return width_mm * height_mm + (segment_b_mm ?? 0) * height_mm;
    case "C_SHAPE":
      return width_mm * height_mm + (segment_b_mm ?? 0) * height_mm + (segment_c_mm ?? 0) * height_mm;
    default:
      throw new Error(`Unknown wall_shape: ${wall_shape}`);
  }
}
function computeNetArea(gross_area_sqmm, opening_deduction_sqmm) {
  const deduction = opening_deduction_sqmm ?? 0;
  const net = gross_area_sqmm - deduction;
  if (net <= 0) {
    throw new Error(
      `INVALID_NET_AREA: net_area_sqmm (${net}) must be > 0. gross=${gross_area_sqmm}, deduction=${deduction}`
    );
  }
  return net;
}
function computeArea(input) {
  const gross_area_sqmm = computeGrossArea(
    input.wall_shape,
    input.width_mm,
    input.height_mm,
    input.segment_b_mm,
    input.segment_c_mm
  );
  const deduction = input.opening_deduction_sqmm ?? 0;
  const net_area_sqmm = computeNetArea(gross_area_sqmm, deduction);
  return {
    gross_area_sqmm,
    net_area_sqmm,
    opening_deduction_sqmm: deduction
  };
}

// packages/config-engine/src/rules/r1-installation-type.ts
function determineInstallationType(lightingType) {
  switch (lightingType) {
    case "NONE":
      return "DIRECT";
    case "PROFILE_LIGHT":
    case "COVE_LIGHT":
      return "FRAME_BASED";
    default:
      throw new Error(`R1: Unknown lighting_type: ${lightingType}`);
  }
}

// packages/config-engine/src/rules/r2-base-board.ts
function determineBaseBoardThickness(lightingType) {
  switch (lightingType) {
    case "NONE":
      return 0;
    case "PROFILE_LIGHT":
      return 5;
    case "COVE_LIGHT":
      return 10;
    default:
      throw new Error(`R2: Unknown lighting_type: ${lightingType}`);
  }
}

// packages/config-engine/src/rules/r3-moisture.ts
function determineMoistureAddition(moistureLevel) {
  switch (moistureLevel) {
    case "HIGH":
      return 5;
    case "DRY":
    case "AMBIENT":
      return 0;
    default:
      throw new Error(`R3: Unknown moisture_level: ${moistureLevel}`);
  }
}
function computeTotalBaseBoardThickness(r2Thickness, moistureLevel) {
  return r2Thickness + determineMoistureAddition(moistureLevel);
}

// packages/config-engine/src/formulas/quantity.ts
function computePanelQuantity(net_area_sqmm, panel_width_mm, panel_height_mm) {
  if (net_area_sqmm <= 0) {
    throw new Error("INVALID_NET_AREA: net_area_sqmm must be > 0");
  }
  if (panel_width_mm <= 0 || panel_height_mm <= 0) {
    throw new Error("INVALID_PANEL_DIMENSIONS: width_mm and height_mm must be > 0");
  }
  const panelArea = panel_width_mm * panel_height_mm;
  return Math.ceil(net_area_sqmm / panelArea);
}
function computePerSqm(net_area_sqmm, factor = 1) {
  if (net_area_sqmm <= 0) {
    throw new Error("INVALID_NET_AREA: net_area_sqmm must be > 0");
  }
  const area_sqm = net_area_sqmm / 1e6;
  return area_sqm * factor;
}
function computePerRftPerimeter(width_mm, height_mm, factor = 1) {
  if (width_mm <= 0 || height_mm <= 0) {
    throw new Error("INVALID_DIMENSIONS: width_mm and height_mm must be > 0");
  }
  const perimeter_mm = 2 * (width_mm + height_mm);
  const perimeter_rft = perimeter_mm / 304.8;
  return perimeter_rft * factor;
}
function computeFixedPerSpace(quantity = 1) {
  return quantity;
}
function computeFixedPerProject(quantity = 1) {
  return quantity;
}

// packages/config-engine/src/rules/r4-panel-quantity.ts
function computePanelLineItem(input) {
  if (!input.panel_width_mm || input.panel_width_mm <= 0) {
    throw new Error(
      `R4: Panel SKU '${input.panel_sku}' has invalid width_mm (${input.panel_width_mm}). WALL_PANEL SKUs must have non-null positive width_mm in product_library.`
    );
  }
  if (!input.panel_height_mm || input.panel_height_mm <= 0) {
    throw new Error(
      `R4: Panel SKU '${input.panel_sku}' has invalid height_mm (${input.panel_height_mm}). WALL_PANEL SKUs must have non-null positive height_mm in product_library.`
    );
  }
  const area = computeArea({
    wall_shape: input.wall_shape,
    width_mm: input.width_mm,
    height_mm: input.height_mm,
    segment_b_mm: input.segment_b_mm,
    segment_c_mm: input.segment_c_mm,
    opening_deduction_sqmm: input.opening_deduction_sqmm
  });
  const quantity = computePanelQuantity(
    area.net_area_sqmm,
    input.panel_width_mm,
    input.panel_height_mm
  );
  return {
    sku: input.panel_sku,
    product_role: "PRIMARY",
    quantity,
    unit_label: "pc",
    unit_cost_paise: input.panel_unit_cost_paise,
    sell_price_paise: input.panel_sell_price_paise,
    group_name: "WALL_PANEL",
    generated_by_rule: "R4",
    _gross_area_sqmm: area.gross_area_sqmm,
    _net_area_sqmm: area.net_area_sqmm,
    _panel_area_sqmm: input.panel_width_mm * input.panel_height_mm
  };
}

// packages/config-engine/src/rules/r5-trim-auto-link.ts
function computeTrimLineItems(input) {
  if (input.trim_elements.length === 0) {
    return [];
  }
  for (const trim of input.trim_elements) {
    if (!trim.sku_is_active || trim.sku_status !== "ACTIVE") {
      throw new Error(
        `TRIM_SKU_NOT_FOUND: Trim SKU '${trim.sku}' is not active (status: ${trim.sku_status}). Cannot auto-link inactive trim.`
      );
    }
    if (input.panel_colour_variant && trim.colour_variant) {
      if (trim.colour_variant !== input.panel_colour_variant) {
        throw new Error(
          `TRIM_VARIANT_MISMATCH: Trim SKU '${trim.sku}' has colour_variant='${trim.colour_variant}' but resolved panel has colour_variant='${input.panel_colour_variant}'. Trim must match panel colour per R5 compatibility rule (AD-24).`
        );
      }
    }
    if (input.panel_finish_variant && trim.finish_variant) {
      if (trim.finish_variant !== input.panel_finish_variant) {
        throw new Error(
          `TRIM_VARIANT_MISMATCH: Trim SKU '${trim.sku}' has finish_variant='${trim.finish_variant}' but resolved panel has finish_variant='${input.panel_finish_variant}'. Trim must match panel finish per R5 compatibility rule (AD-24).`
        );
      }
    }
  }
  const quantity_rft = computePerRftPerimeter(input.width_mm, input.height_mm);
  return input.trim_elements.map((trim) => ({
    sku: trim.sku,
    product_role: "TRIM",
    quantity: quantity_rft * (trim.default_quantity || 1),
    unit_label: "rft",
    unit_cost_paise: trim.unit_cost_paise,
    sell_price_paise: trim.sell_price_paise,
    group_name: "TRIM",
    generated_by_rule: "R5",
    colour_variant: trim.colour_variant
  }));
}

// packages/config-engine/src/rules/r6-structural-board.ts
function computeStructuralBoardLineItem(input) {
  if (input.total_board_thickness_mm <= 0) {
    return null;
  }
  const quantity_sqm = computePerSqm(input.net_area_sqmm);
  return {
    sku: input.board_sku,
    product_role: "CONSUMABLE",
    quantity: quantity_sqm,
    unit_label: "sqm",
    unit_cost_paise: input.board_unit_cost_paise,
    sell_price_paise: input.board_sell_price_paise,
    group_name: "CONSUMABLE",
    generated_by_rule: "R6"
  };
}

// packages/config-engine/src/rules/r7-consumables.ts
function evaluateCondition(consumable, config) {
  if (!consumable.condition_field || !consumable.condition_value) {
    return true;
  }
  const configValue = config[consumable.condition_field];
  if (configValue === void 0 || configValue === null) {
    return false;
  }
  return String(configValue) === consumable.condition_value;
}
function computeConsumableQuantity(formula, config) {
  switch (formula) {
    case "PER_SQM":
      return { quantity: computePerSqm(config.net_area_sqmm), unit_label: "sqm" };
    case "FIXED_PER_SPACE":
      return { quantity: computeFixedPerSpace(), unit_label: "unit" };
    case "FIXED_PER_PROJECT":
      return { quantity: computeFixedPerProject(), unit_label: "unit" };
    case "PER_RFT_PERIMETER": {
      const perimeterRft = 2 * (config.width_mm + config.height_mm) / 304.8;
      return { quantity: perimeterRft, unit_label: "rft" };
    }
    case "PER_RFT_HEIGHT": {
      const heightQty = config.height_mm / 1e3;
      return { quantity: heightQty, unit_label: "rft" };
    }
    default:
      throw new Error(`R7: Unknown quantity_formula: ${formula}`);
  }
}
function computeConsumableLineItems(consumables, config) {
  const results = [];
  for (const consumable of consumables) {
    if (!evaluateCondition(consumable, config)) {
      continue;
    }
    const { quantity, unit_label } = computeConsumableQuantity(
      consumable.quantity_formula,
      config
    );
    results.push({
      sku: consumable.sku,
      product_role: "CONSUMABLE",
      quantity,
      unit_label,
      group_name: "CONSUMABLE",
      generated_by_rule: "R7"
    });
  }
  return results;
}

// packages/config-engine/src/rules/r8-configuration-hash.ts
async function computeConfigurationHash(input) {
  const sortedInput = {
    template_id: input.template_id,
    measurements: input.measurements,
    line_items: [...input.line_items].sort(compareLineItems),
    furniture: [...input.furniture].sort(compareFurniture)
  };
  const canonical = canonicalize(sortedInput);
  const encoded = new TextEncoder().encode(canonical);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return bytesToHex(new Uint8Array(hashBuffer));
}
function compareLineItems(a, b) {
  const skuCmp = a.sku.localeCompare(b.sku);
  if (skuCmp !== 0) return skuCmp;
  const groupCmp = a.group_name.localeCompare(b.group_name);
  if (groupCmp !== 0) return groupCmp;
  return a.product_role.localeCompare(b.product_role);
}
function compareFurniture(a, b) {
  const skuCmp = a.sku.localeCompare(b.sku);
  if (skuCmp !== 0) return skuCmp;
  const posA = a.default_position ?? "zzz";
  const posB = b.default_position ?? "zzz";
  return posA.localeCompare(posB);
}
function canonicalize(obj) {
  if (obj === null || obj === void 0) {
    return "";
  }
  if (typeof obj === "number" || typeof obj === "boolean") {
    return JSON.stringify(obj);
  }
  if (typeof obj === "string") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    const elements = obj.map((item) => canonicalize(item));
    return "[" + elements.join(",") + "]";
  }
  if (typeof obj === "object") {
    const keys = Object.keys(obj).sort();
    const pairs = [];
    for (const key of keys) {
      const value = obj[key];
      if (value === null || value === void 0) {
        continue;
      }
      pairs.push(JSON.stringify(key) + ":" + canonicalize(value));
    }
    return "{" + pairs.join(",") + "}";
  }
  return JSON.stringify(obj);
}
function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// packages/config-engine/src/rules/index.ts
async function runConfigurationEngine(input) {
  if (!input.compatible_materials.includes(input.material_preference)) {
    throw new Error(
      `TEMPLATE_MATERIAL_MISMATCH: material_preference '${input.material_preference}' is not in template's compatible_materials: [${input.compatible_materials.join(", ")}]`
    );
  }
  const installation_type = determineInstallationType(input.lighting_type);
  const r2Thickness = determineBaseBoardThickness(input.lighting_type);
  const back_board_mm = computeTotalBaseBoardThickness(r2Thickness, input.moisture_level);
  const area = computeArea({
    wall_shape: input.wall_shape,
    width_mm: input.width_mm,
    height_mm: input.height_mm,
    segment_b_mm: input.segment_b_mm,
    segment_c_mm: input.segment_c_mm,
    opening_deduction_sqmm: input.opening_deduction_sqmm
  });
  const panelLineItem = computePanelLineItem({
    wall_shape: input.wall_shape,
    width_mm: input.width_mm,
    height_mm: input.height_mm,
    segment_b_mm: input.segment_b_mm,
    segment_c_mm: input.segment_c_mm,
    opening_deduction_sqmm: input.opening_deduction_sqmm,
    panel_sku: input.panel_sku,
    panel_width_mm: input.panel_width_mm,
    panel_height_mm: input.panel_height_mm,
    panel_unit_cost_paise: input.panel_unit_cost_paise,
    panel_sell_price_paise: input.panel_sell_price_paise
  });
  const trimLineItems = computeTrimLineItems({
    trim_elements: input.trim_elements,
    width_mm: input.width_mm,
    height_mm: input.height_mm,
    panel_colour_variant: input.panel_colour_variant,
    panel_finish_variant: input.panel_finish_variant
  });
  const structuralBoard = computeStructuralBoardLineItem({
    total_board_thickness_mm: back_board_mm,
    net_area_sqmm: area.net_area_sqmm,
    board_sku: input.board_sku,
    board_unit_cost_paise: input.board_unit_cost_paise,
    board_sell_price_paise: input.board_sell_price_paise
  });
  const configState = {
    installation_type,
    moisture_level: input.moisture_level,
    wall_shape: input.wall_shape,
    lighting_type: input.lighting_type,
    material_preference: input.material_preference,
    net_area_sqmm: area.net_area_sqmm,
    width_mm: input.width_mm,
    height_mm: input.height_mm
  };
  const consumableLineItems = computeConsumableLineItems(input.template_consumables, configState);
  const allLineItems = [
    panelLineItem,
    ...trimLineItems,
    ...structuralBoard ? [structuralBoard] : [],
    ...consumableLineItems
  ];
  const hashInput = {
    template_id: input.template_id,
    measurements: {
      width_mm: input.width_mm,
      height_mm: input.height_mm,
      segment_b_mm: input.segment_b_mm,
      segment_c_mm: input.segment_c_mm,
      opening_deduction_sqmm: input.opening_deduction_sqmm ?? null,
      gross_area_sqmm: area.gross_area_sqmm,
      net_area_sqmm: area.net_area_sqmm
    },
    line_items: allLineItems.map((li) => ({
      sku: li.sku,
      quantity: li.quantity,
      unit_label: li.unit_label,
      product_role: li.product_role,
      group_name: li.group_name
    })),
    furniture: input.furniture
  };
  const configuration_hash = await computeConfigurationHash(hashInput);
  return {
    installation_type,
    back_board_mm,
    gross_area_sqmm: area.gross_area_sqmm,
    net_area_sqmm: area.net_area_sqmm,
    line_items: allLineItems,
    configuration_hash
  };
}
export {
  runConfigurationEngine
};
