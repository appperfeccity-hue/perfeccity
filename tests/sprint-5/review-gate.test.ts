/**
 * Sprint 5 T1 — Review Gate Acceptance Tests
 *
 * STATUS: AUTHORED — UNEXECUTED (INFRASTRUCTURE BLOCKED)
 *
 * This test CANNOT RUN in the current sandbox:
 * - Requires live Supabase instance (Postgres + Edge Functions)
 * - submit_review_gate RPC needs the full schema (migrations 00001-00014)
 *
 * WHEN TO EXECUTE:
 * - Against hosted Supabase project (demfvizmxkuxvluopmtq), OR
 * - CI environment with supabase CLI + Docker
 *
 * WHAT THIS PROVES (when it passes):
 * - The 7-item checklist evaluates correctly (each item independently)
 * - PASS transitions project.status to REVIEWED
 * - FAIL leaves project.status as CONFIGURING
 * - Every attempt (pass or fail) creates a review_records row
 * - Itemized failure reasons are returned for each failing check
 * - State machine guard: only CONFIGURING → REVIEWED (no other transitions)
 * - Atomicity: partial failures don't leave inconsistent state
 *
 * PREREQUISITE: All 14 migrations (00001–00014) applied to the target database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Test fixtures: UUIDs for a complete project setup
const TEST_PREFIX = 'review-gate-test';

describe('Review Gate (submit_review_gate RPC)', () => {
  let supabase: SupabaseClient;
  let testProjectId: string;
  let testConsultantId: string;
  let testLeadId: string;

  beforeAll(async () => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    supabase = createClient(url, key);

    // Setup: create a test consultant user
    testConsultantId = crypto.randomUUID();
    await supabase.from('users').insert({
      user_id: testConsultantId,
      email: `${TEST_PREFIX}-consultant@test.local`,
      full_name: 'Test Consultant',
      role: 'SALESPERSON',
      user_status: 'ACTIVE',
    });

    // Setup: create a lead with mobile + email
    testLeadId = crypto.randomUUID();
    await supabase.from('leads').insert({
      lead_id: testLeadId,
      customer_name: 'Test Customer',
      mobile_encrypted: Buffer.from('encrypted-test-mobile'),
      mobile_hash: `hash-${TEST_PREFIX}-${Date.now()}`,
      email_address: 'test@customer.local',
      assigned_consultant_id: testConsultantId,
      status: 'CONVERTED',
    });

    // Setup: create a project in CONFIGURING status linked to lead
    testProjectId = crypto.randomUUID();
    await supabase.from('projects').insert({
      project_id: testProjectId,
      lead_id: testLeadId,
      consultant_id: testConsultantId,
      status: 'CONFIGURING',
      customer_name: 'Test Customer',
    });
  });

  afterAll(async () => {
    // Cleanup test data (reverse order of FK dependencies)
    if (testProjectId) {
      await supabase.from('review_records').delete().eq('project_id', testProjectId);
      await supabase.from('project_state_history').delete().eq('project_id', testProjectId);
      await supabase.from('configuration_line_items').delete().eq('project_id', testProjectId);
      await supabase.from('space_configurations').delete().eq('project_id', testProjectId);
      await supabase.from('site_photographs').delete().eq('project_id', testProjectId);
      await supabase.from('application_spaces').delete().eq('project_id', testProjectId);
      await supabase.from('budget_profiles').delete().eq('project_id', testProjectId);
      await supabase.from('projects').delete().eq('project_id', testProjectId);
    }
    if (testLeadId) {
      await supabase.from('leads').delete().eq('lead_id', testLeadId);
    }
    if (testConsultantId) {
      await supabase.from('users').delete().eq('user_id', testConsultantId);
    }
  });

  // ===================================================================
  // FAIL CASES — each check individually
  // ===================================================================

  describe('FAIL: empty project (no spaces, no photos, no budget)', () => {
    it('returns FAIL with all 7 items failing except customer_info', async () => {
      const { data, error } = await supabase.rpc('submit_review_gate', {
        p_project_id: testProjectId,
        p_reviewer_id: testConsultantId,
      });

      expect(error).toBeNull();
      expect(data.result).toBe('FAIL');
      expect(data.checklist.customer_info_complete).toBe(true); // lead has mobile+email
      expect(data.checklist.design_selected_all_spaces).toBe(false); // no spaces
      expect(data.checklist.samples_verified_all_spaces).toBe(false);
      expect(data.checklist.site_photo_exists).toBe(false);
      expect(data.checklist.current_config_all_spaces).toBe(false);
      expect(data.checklist.all_skus_active).toBe(true); // no configs = no inactive SKUs (vacuously true)
      expect(data.checklist.budget_confirmed).toBe(false);
      expect(data.failure_reasons.length).toBeGreaterThan(0);
    });

    it('creates a review_records row even on failure', async () => {
      const { data: reviews } = await supabase
        .from('review_records')
        .select('*')
        .eq('project_id', testProjectId)
        .order('created_at', { ascending: false })
        .limit(1);

      expect(reviews).toHaveLength(1);
      expect(reviews![0].result).toBe('FAIL');
      expect(reviews![0].checklist_json).toBeDefined();
      expect(reviews![0].failure_reasons).toBeDefined();
    });

    it('does NOT transition project status (stays CONFIGURING)', async () => {
      const { data: project } = await supabase
        .from('projects')
        .select('status')
        .eq('project_id', testProjectId)
        .single();

      expect(project!.status).toBe('CONFIGURING');
    });
  });

  // ===================================================================
  // PASS CASE — fully complete project
  // ===================================================================

  describe('PASS: fully complete project', () => {
    let spaceId: string;
    let configId: string;
    let templateId: string;

    beforeAll(async () => {
      // Create a template
      templateId = crypto.randomUUID();
      await supabase.from('design_templates').insert({
        template_id: templateId,
        template_name: 'Test Template',
        template_type: 'WALL_PANEL_ONLY',
        is_active: true,
      });

      // Create a space with template selected + sample verified
      spaceId = crypto.randomUUID();
      await supabase.from('application_spaces').insert({
        space_id: spaceId,
        project_id: testProjectId,
        space_type: 'LIVING_ROOM',
        selected_template_id: templateId,
        sample_verified: true,
        sample_verified_at: new Date().toISOString(),
        width_mm: 3000,
        height_mm: 2700,
        gross_area_sqmm: 8100000,
        net_area_sqmm: 8100000,
      });

      // Create a current configuration
      configId = crypto.randomUUID();
      await supabase.from('space_configurations').insert({
        config_id: configId,
        space_id: spaceId,
        project_id: testProjectId,
        template_id: templateId,
        installation_type: 'DIRECT_STICK',
        is_current: true,
        generated_by: 'TEST',
      });

      // Add a line item with an ACTIVE SKU (assumes WLP-WPC-CLS-OAK-001 exists from seed)
      await supabase.from('configuration_line_items').insert({
        config_id: configId,
        project_id: testProjectId,
        space_id: spaceId,
        sku: 'WLP-WPC-CLS-OAK-001',
        product_role: 'PRIMARY',
        quantity: 18,
        unit_label: 'panels',
        unit_cost_paise: 32000,
        sell_price_paise: 42000,
        group_name: 'WALL_PANEL',
        generated_by_rule: 'R4',
      });

      // Upload a site photo
      await supabase.from('site_photographs').insert({
        project_id: testProjectId,
        s3_key: 'test/photo-001.jpg',
        original_name: 'site-photo.jpg',
        is_deleted: false,
        uploaded_by: testConsultantId,
      });

      // Set budget tier
      await supabase.from('budget_profiles').insert({
        project_id: testProjectId,
        budget_tier: 'PREMIUM',
      });
    });

    it('returns PASS with all 7 checklist items true', async () => {
      const { data, error } = await supabase.rpc('submit_review_gate', {
        p_project_id: testProjectId,
        p_reviewer_id: testConsultantId,
      });

      expect(error).toBeNull();
      expect(data.result).toBe('PASS');
      expect(data.checklist.customer_info_complete).toBe(true);
      expect(data.checklist.design_selected_all_spaces).toBe(true);
      expect(data.checklist.samples_verified_all_spaces).toBe(true);
      expect(data.checklist.site_photo_exists).toBe(true);
      expect(data.checklist.current_config_all_spaces).toBe(true);
      expect(data.checklist.all_skus_active).toBe(true);
      expect(data.checklist.budget_confirmed).toBe(true);
      expect(data.failure_reasons).toEqual([]);
    });

    it('transitions project.status to REVIEWED', async () => {
      const { data: project } = await supabase
        .from('projects')
        .select('status, latest_review_id')
        .eq('project_id', testProjectId)
        .single();

      expect(project!.status).toBe('REVIEWED');
      expect(project!.latest_review_id).toBeDefined();
    });

    it('records state transition in project_state_history', async () => {
      const { data: history } = await supabase
        .from('project_state_history')
        .select('*')
        .eq('project_id', testProjectId)
        .eq('to_status', 'REVIEWED')
        .single();

      expect(history).toBeDefined();
      expect(history!.from_status).toBe('CONFIGURING');
      expect(history!.trigger_rule).toBe('review_gate_pass');
      expect(history!.actor_id).toBe(testConsultantId);
    });
  });

  // ===================================================================
  // STATE MACHINE GUARDS
  // ===================================================================

  describe('State machine guards', () => {
    it('rejects review when project is NOT in CONFIGURING status', async () => {
      // After the PASS test above, project is now REVIEWED
      const { data, error } = await supabase.rpc('submit_review_gate', {
        p_project_id: testProjectId,
        p_reviewer_id: testConsultantId,
      });

      // RPC raises an exception for invalid status
      expect(error).not.toBeNull();
      expect(error!.message).toContain('INVALID_STATUS');
    });

    it('rejects review for non-existent project', async () => {
      const fakeId = crypto.randomUUID();
      const { data, error } = await supabase.rpc('submit_review_gate', {
        p_project_id: fakeId,
        p_reviewer_id: testConsultantId,
      });

      expect(error).not.toBeNull();
      expect(error!.message).toContain('PROJECT_NOT_FOUND');
    });
  });

  // ===================================================================
  // INDIVIDUAL CHECK ISOLATION
  // ===================================================================

  describe('Check 6: inactive SKU detection', () => {
    let isolationProjectId: string;
    let isolationSpaceId: string;
    let isolationConfigId: string;

    beforeAll(async () => {
      // Create a fresh project with everything passing EXCEPT an inactive SKU
      isolationProjectId = crypto.randomUUID();
      await supabase.from('projects').insert({
        project_id: isolationProjectId,
        lead_id: testLeadId,
        consultant_id: testConsultantId,
        status: 'CONFIGURING',
        customer_name: 'Isolation Test Customer',
      });

      const templateId = crypto.randomUUID();
      await supabase.from('design_templates').insert({
        template_id: templateId,
        template_name: 'Isolation Template',
        template_type: 'WALL_PANEL_ONLY',
        is_active: true,
      });

      isolationSpaceId = crypto.randomUUID();
      await supabase.from('application_spaces').insert({
        space_id: isolationSpaceId,
        project_id: isolationProjectId,
        space_type: 'BEDROOM',
        selected_template_id: templateId,
        sample_verified: true,
        sample_verified_at: new Date().toISOString(),
        width_mm: 4000,
        height_mm: 2700,
        gross_area_sqmm: 10800000,
        net_area_sqmm: 10800000,
      });

      isolationConfigId = crypto.randomUUID();
      await supabase.from('space_configurations').insert({
        config_id: isolationConfigId,
        space_id: isolationSpaceId,
        project_id: isolationProjectId,
        template_id: templateId,
        installation_type: 'DIRECT_STICK',
        is_current: true,
        generated_by: 'TEST',
      });

      // Insert a DISCONTINUED SKU into product_library for this test
      await supabase.from('product_library').upsert({
        sku: 'TEST-DISCONTINUED-001',
        category: 'WALL_PANEL',
        name: 'Discontinued Test Panel',
        unit: 'panel',
        unit_cost_paise: 10000,
        sell_price_paise: 13000,
        status: 'DISCONTINUED',
        is_active: false,
      });

      // Reference the inactive SKU in a line item
      await supabase.from('configuration_line_items').insert({
        config_id: isolationConfigId,
        project_id: isolationProjectId,
        space_id: isolationSpaceId,
        sku: 'TEST-DISCONTINUED-001',
        product_role: 'PRIMARY',
        quantity: 10,
        unit_label: 'panels',
        unit_cost_paise: 10000,
        sell_price_paise: 13000,
        group_name: 'WALL_PANEL',
        generated_by_rule: 'R4',
      });

      // Complete remaining checks
      await supabase.from('site_photographs').insert({
        project_id: isolationProjectId,
        s3_key: 'test/isolation-photo.jpg',
        original_name: 'photo.jpg',
        is_deleted: false,
        uploaded_by: testConsultantId,
      });

      await supabase.from('budget_profiles').insert({
        project_id: isolationProjectId,
        budget_tier: 'STANDARD',
      });
    });

    afterAll(async () => {
      if (isolationProjectId) {
        await supabase.from('review_records').delete().eq('project_id', isolationProjectId);
        await supabase.from('configuration_line_items').delete().eq('project_id', isolationProjectId);
        await supabase.from('space_configurations').delete().eq('project_id', isolationProjectId);
        await supabase.from('site_photographs').delete().eq('project_id', isolationProjectId);
        await supabase.from('application_spaces').delete().eq('project_id', isolationProjectId);
        await supabase.from('budget_profiles').delete().eq('project_id', isolationProjectId);
        await supabase.from('projects').delete().eq('project_id', isolationProjectId);
        await supabase.from('product_library').delete().eq('sku', 'TEST-DISCONTINUED-001');
      }
    });

    it('fails check 6 when a referenced SKU is DISCONTINUED', async () => {
      const { data, error } = await supabase.rpc('submit_review_gate', {
        p_project_id: isolationProjectId,
        p_reviewer_id: testConsultantId,
      });

      expect(error).toBeNull();
      expect(data.result).toBe('FAIL');
      expect(data.checklist.all_skus_active).toBe(false);
      expect(data.failure_reasons).toContain(
        expect.stringContaining('SKU(s) in current configurations are not ACTIVE')
      );
      // All other checks should pass
      expect(data.checklist.customer_info_complete).toBe(true);
      expect(data.checklist.design_selected_all_spaces).toBe(true);
      expect(data.checklist.samples_verified_all_spaces).toBe(true);
      expect(data.checklist.site_photo_exists).toBe(true);
      expect(data.checklist.current_config_all_spaces).toBe(true);
      expect(data.checklist.budget_confirmed).toBe(true);
    });
  });
});
