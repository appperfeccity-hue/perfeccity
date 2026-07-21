/**
 * Edge Function: api-manufacturing
 * Sprint 7 T6 — Manufacturing Package Management (Admin only)
 *
 * Endpoints:
 * - GET  /api/v1/manufacturing/projects/:id/package     (view status)
 * - POST /api/v1/manufacturing/projects/:id/package/regenerate (re-run on FAILED)
 * - GET  /api/v1/manufacturing/projects/:id/package/download   (signed URL)
 *
 * Role: ADMIN only (per Part 2 permission matrix — Manager has NO manufacturing access)
 *
 * WF-6 Regenerate Rule (frozen):
 * - Only after technical failure (FAILED status)
 * - Never modifies configuration, pricing, BOM — output recovery only
 * - Uses existing immutable snapshot
 * - Logged, never silent
 *
 * Note on package generation (WF-6): The automatic trigger
 * (advance_payments.status → CONFIRMED → worker job → package) is
 * infrastructure-side (BullMQ worker). For MVP, this endpoint simulates
 * the trigger by creating/updating the manufacturing_packages row directly.
 * A real worker would do the PDF/ZIP generation and S3 upload.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireAuth } from '../_shared/middleware/rbac.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { success, error } from '../_shared/response.ts';

serve(async (req: Request) => {
  const url = new URL(req.url);
  const method = req.method;

  // ADMIN only — Manager has NO manufacturing access per Part 2
  const rbac = await requireAuth(req, ['ADMIN']);
  if (!rbac.ok) return rbac.response;

  try {
    const admin = getAdminClient();
    const projectId = extractProjectId(url.pathname);

    if (!projectId) {
      return error('BAD_REQUEST', 'Project ID required in path', 400);
    }

    // GET .../package — view status
    if (method === 'GET' && !url.pathname.includes('/download') && !url.pathname.includes('/regenerate')) {
      return await handleGetPackage(admin, projectId);
    }

    // POST .../package/regenerate — re-run on FAILED only
    if (method === 'POST' && url.pathname.includes('/regenerate')) {
      return await handleRegenerate(admin, projectId, rbac.auth.userId);
    }

    // POST .../package/generate — initial generation trigger (Admin manual)
    if (method === 'POST' && url.pathname.includes('/generate') && !url.pathname.includes('/regenerate')) {
      return await handleGenerate(admin, projectId, rbac.auth.userId);
    }

    // GET .../package/download — signed download URL
    if (method === 'GET' && url.pathname.includes('/download')) {
      return await handleDownload(admin, projectId);
    }

    return error('NOT_FOUND', 'Endpoint not found', 404);
  } catch (e) {
    console.error('api-manufacturing error:', e);
    return error('INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
});

// ============================================================
// View Package Status
// ============================================================

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

async function handleGetPackage(
  admin: SupabaseClient,
  projectId: string
): Promise<Response> {
  const { data: pkg } = await admin
    .from('manufacturing_packages')
    .select('package_id, status, s3_manifest_key, generated_at, ready_at')
    .eq('project_id', projectId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .single();

  if (!pkg) {
    return success({
      project_id: projectId,
      package: null,
      message: 'No manufacturing package found for this project',
    });
  }

  return success({
    project_id: projectId,
    package: {
      package_id: pkg.package_id,
      status: pkg.status,
      has_manifest: !!pkg.s3_manifest_key,
      generated_at: pkg.generated_at,
      ready_at: pkg.ready_at,
    },
  });
}

// ============================================================
// Regenerate (WF-6 Regenerate Rule — FAILED only, immutable snapshot)
// ============================================================

async function handleRegenerate(
  admin: SupabaseClient,
  projectId: string,
  actorId: string
): Promise<Response> {
  // Get existing package
  const { data: pkg } = await admin
    .from('manufacturing_packages')
    .select('package_id, status, snapshot_id')
    .eq('project_id', projectId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .single();

  // Guard: must have a FAILED package to regenerate
  if (!pkg) {
    return error('NO_PACKAGE',
      'No manufacturing package found. Package generation is triggered automatically on payment confirmation.', 404);
  }

  if (pkg.status !== 'FAILED') {
    return error('REGENERATE_NOT_ALLOWED',
      `Package regeneration is only permitted when status is FAILED (current: ${pkg.status}). ` +
      'Per WF-6: regenerate is for technical failure recovery only, never for configuration changes.', 422);
  }

  // Regenerate: insert a new GENERATING row (FAILED row stays for audit trail)
  // The `one_active_package_per_project` partial unique index allows this
  // because FAILED rows don't match `WHERE status IN ('GENERATING','READY')`
  const { data: newPkg, error: insertErr } = await admin
    .from('manufacturing_packages')
    .insert({
      project_id: projectId,
      snapshot_id: pkg.snapshot_id,
      status: 'GENERATING',
      generated_by: actorId,
    })
    .select('package_id')
    .single();

  if (insertErr) {
    console.error('Regenerate insert failed:', insertErr);
    return error('REGENERATE_FAILED', 'Failed to initiate package regeneration', 500);
  }

  // In a real system, this would enqueue a BullMQ job.
  // For MVP: immediately generate the package (synchronous in Edge Function)
  await generateManufacturingPackage(admin, projectId, newPkg.package_id, pkg.snapshot_id);

  return success({
    project_id: projectId,
    new_package_id: newPkg.package_id,
    status: 'GENERATING',
    message: 'Package regeneration initiated. Previous FAILED record retained for audit.',
    note: 'This regeneration uses the existing immutable BOM snapshot — no configuration changes.',
  }, 201);
}

// ============================================================
// Download (returns S3 key — real implementation would sign the URL)
// ============================================================

async function handleDownload(
  admin: SupabaseClient,
  projectId: string
): Promise<Response> {
  const { data: pkg } = await admin
    .from('manufacturing_packages')
    .select('package_id, status, s3_manifest_key, installation_drawings_s3_key')
    .eq('project_id', projectId)
    .eq('status', 'READY')
    .order('ready_at', { ascending: false })
    .limit(1)
    .single();

  if (!pkg) {
    return error('PACKAGE_NOT_READY',
      'No READY manufacturing package found for this project', 404);
  }

  if (!pkg.s3_manifest_key) {
    return error('PACKAGE_INCOMPLETE',
      'Package exists but S3 manifest key is not set', 404);
  }

  // In production: generate signed S3 URL (time-limited)
  // For MVP: return the S3 key for the Admin to use directly
  return success({
    package_id: pkg.package_id,
    s3_manifest_key: pkg.s3_manifest_key,
    installation_drawings_s3_key: pkg.installation_drawings_s3_key,
    note: 'In production, this returns a time-limited signed URL. MVP returns the S3 key directly.',
  });
}

// ============================================================
// Generate Package (initial trigger — Admin manual for MVP)
// ============================================================

async function handleGenerate(
  admin: SupabaseClient,
  projectId: string,
  actorId: string
): Promise<Response> {
  // Guard: project must be APPROVED (payment confirmed)
  const { data: project } = await admin
    .from('projects')
    .select('status, latest_snapshot_id')
    .eq('project_id', projectId)
    .single();

  if (!project) return error('PROJECT_NOT_FOUND', 'Project not found', 404);
  if (project.status !== 'APPROVED') {
    return error('INVALID_STATUS', `Project must be APPROVED to generate package (current: ${project.status})`, 422);
  }
  if (!project.latest_snapshot_id) {
    return error('NO_SNAPSHOT', 'Project has no sealed quotation snapshot', 422);
  }

  // Check no active package already exists
  const { data: existing } = await admin
    .from('manufacturing_packages')
    .select('package_id, status')
    .eq('project_id', projectId)
    .in('status', ['GENERATING', 'READY'])
    .limit(1)
    .single();

  if (existing) {
    return error('PACKAGE_EXISTS', `A ${existing.status} package already exists`, 409);
  }

  // Create package row
  const { data: pkg, error: insertErr } = await admin
    .from('manufacturing_packages')
    .insert({
      project_id: projectId,
      snapshot_id: project.latest_snapshot_id,
      status: 'GENERATING',
      generated_by: actorId,
    })
    .select('package_id')
    .single();

  if (insertErr) return error('DB_ERROR', 'Failed to create package: ' + insertErr.message, 500);

  // Generate synchronously for MVP
  await generateManufacturingPackage(admin, projectId, pkg.package_id, project.latest_snapshot_id);

  return success({
    project_id: projectId,
    package_id: pkg.package_id,
    status: 'READY',
    message: 'Manufacturing package generated successfully',
  }, 201);
}

// ============================================================
// Package Generation Logic (WF-6)
// Assembles BOM + cut lists + installation notes into a JSON manifest
// ============================================================

async function generateManufacturingPackage(
  admin: SupabaseClient,
  projectId: string,
  packageId: string,
  snapshotId: string
): Promise<void> {
  try {
    // Gather all data needed for the manufacturing package
    const [projectData, spaces, bomLines, configs] = await Promise.all([
      admin.from('projects').select('customer_name, project_address, city, project_type').eq('project_id', projectId).single(),
      admin.from('application_spaces').select('space_id, space_type, wall_shape, width_mm, height_mm, selected_template_id').eq('project_id', projectId),
      admin.from('bom_lines').select('*').eq('snapshot_id', snapshotId),
      admin.from('space_configurations').select('*, configuration_line_items(*)').eq('project_id', projectId).eq('is_current', true),
    ]);

    // Get site assessment
    const { data: siteAssessment } = await admin
      .from('site_assessments')
      .select('wall_type, moisture_level, has_electrical')
      .eq('project_id', projectId)
      .single();

    // Assemble the manufacturing manifest
    const manifest = {
      version: '1.0',
      generated_at: new Date().toISOString(),
      project: {
        project_id: projectId,
        customer_name: projectData.data?.customer_name,
        address: projectData.data?.project_address,
        city: projectData.data?.city,
        project_type: projectData.data?.project_type,
      },
      site: {
        wall_type: siteAssessment?.wall_type,
        moisture_level: siteAssessment?.moisture_level,
        has_electrical: siteAssessment?.has_electrical,
      },
      spaces: (spaces.data || []).map(space => {
        const spaceConfig = (configs.data || []).find((c: Record<string, unknown>) => c.space_id === space.space_id);
        return {
          space_id: space.space_id,
          space_type: space.space_type,
          wall_shape: space.wall_shape,
          dimensions: { width_mm: space.width_mm, height_mm: space.height_mm },
          template_id: space.selected_template_id,
          configuration: spaceConfig ? {
            installation_type: spaceConfig.installation_type,
            back_board_mm: spaceConfig.back_board_mm,
            configuration_hash: spaceConfig.configuration_hash,
            line_items: spaceConfig.configuration_line_items || [],
          } : null,
        };
      }),
      bom: {
        snapshot_id: snapshotId,
        lines: bomLines.data || [],
        total_items: bomLines.data?.length || 0,
      },
      cut_list: (configs.data || []).flatMap((c: Record<string, unknown>) => {
        const items = (c.configuration_line_items as Record<string, unknown>[]) || [];
        return items
          .filter(li => li.group_name === 'WALL_PANEL')
          .map(li => ({
            space_id: c.space_id,
            sku: li.sku,
            quantity: li.quantity,
            product_role: li.product_role,
          }));
      }),
    };

    // Store manifest as JSON in the S3 key field (in production: upload to Storage)
    const manifestKey = `manufacturing/${projectId}/manifest-${packageId}.json`;

    // Update package to READY with manifest key
    await admin
      .from('manufacturing_packages')
      .update({
        status: 'READY',
        s3_manifest_key: manifestKey,
        ready_at: new Date().toISOString(),
        manifest_json: manifest, // Store inline for MVP (real: upload to Storage)
      })
      .eq('package_id', packageId);

  } catch (e) {
    console.error('Package generation failed:', e);
    // Mark as FAILED
    await admin
      .from('manufacturing_packages')
      .update({ status: 'FAILED' })
      .eq('package_id', packageId);
  }
}

function extractProjectId(pathname: string): string | null {
  const match = pathname.match(
    /projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  return match ? match[1] : null;
}
