/**
 * Quotation PDF Generation
 *
 * GET /api/v1/projects/:id/quotation/pdf
 * Role: ADMIN, MANAGER, owning SALESPERSON
 *
 * Generates a structured JSON representation of the quotation PDF content.
 * In production, a dedicated PDF renderer (e.g., Puppeteer service, wkhtmltopdf)
 * would consume this JSON and produce the actual PDF file.
 *
 * For MVP: returns the PDF-ready data structure that any renderer can consume.
 * The frontend or a downstream service generates the visual PDF from this.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { success, error } from '../_shared/response.ts';

export async function handleQuotationPdf(
  admin: SupabaseClient,
  projectId: string
): Promise<Response> {
  // Get project + snapshot
  const { data: project } = await admin
    .from('projects')
    .select('project_id, customer_name, project_address, city, project_type, latest_snapshot_id, consultant_id')
    .eq('project_id', projectId)
    .single();

  if (!project) return error('PROJECT_NOT_FOUND', 'Project not found', 404);
  if (!project.latest_snapshot_id) {
    return error('NO_QUOTATION', 'No sealed quotation found', 404);
  }

  // Get snapshot details
  const { data: snapshot } = await admin
    .from('quotation_snapshots')
    .select('snapshot_id, grand_total_paise, step_breakdown, sealed_at, status, sha256_hash')
    .eq('snapshot_id', project.latest_snapshot_id)
    .single();

  if (!snapshot) return error('SNAPSHOT_NOT_FOUND', 'Quotation snapshot not found', 404);

  // Get BOM lines
  const { data: bomLines } = await admin
    .from('bom_lines')
    .select('sku, source, component_label, quantity, unit_label, unit_cost_paise, line_total_paise')
    .eq('snapshot_id', project.latest_snapshot_id)
    .order('source', { ascending: true });

  // Get consultant info
  const { data: consultant } = await admin
    .from('users')
    .select('full_name, email')
    .eq('user_id', project.consultant_id)
    .single();

  // Get spaces
  const { data: spaces } = await admin
    .from('application_spaces')
    .select('space_id, space_type, wall_shape, width_mm, height_mm, selected_template_id')
    .eq('project_id', projectId);

  // Build PDF-ready structure
  const breakdown = (snapshot.step_breakdown || {}) as Record<string, unknown>;

  const pdfData = {
    document_type: 'QUOTATION',
    version: '1.0',
    generated_at: new Date().toISOString(),
    header: {
      company: 'PERFECCITY',
      tagline: 'Premium Wall Design Solutions',
      quotation_id: snapshot.snapshot_id,
      sealed_at: snapshot.sealed_at,
      integrity_hash: snapshot.sha256_hash,
    },
    customer: {
      name: project.customer_name,
      address: project.project_address,
      city: project.city,
      project_type: project.project_type,
    },
    consultant: {
      name: consultant?.full_name || 'N/A',
      email: consultant?.email || 'N/A',
    },
    spaces: (spaces || []).map(s => ({
      type: s.space_type,
      dimensions: `${s.width_mm || '?'}mm × ${s.height_mm || '?'}mm`,
      wall_shape: s.wall_shape,
    })),
    line_items: (bomLines || []).map(line => ({
      description: line.component_label,
      category: line.source,
      sku: line.sku,
      quantity: line.quantity,
      unit: line.unit_label,
      unit_price: `₹${((line.unit_cost_paise || 0) / 100).toFixed(2)}`,
      total: `₹${((line.line_total_paise || 0) / 100).toFixed(2)}`,
    })),
    totals: {
      materials_total: `₹${((breakdown.step_5_non_panel_total_paise as number || 0) / 100 + (breakdown.step_4_wall_panel_total_paise as number || 0) / 100).toFixed(2)}`,
      labour: `₹${((breakdown.step_8_labour_total_paise as number || 0) / 100).toFixed(2)}`,
      transport: `₹${((breakdown.step_9_transport_paise as number || 0) / 100).toFixed(2)}`,
      subtotal: `₹${((breakdown.step_11_subtotal_paise as number || 0) / 100).toFixed(2)}`,
      margin: `₹${((breakdown.step_12_margin_paise as number || 0) / 100).toFixed(2)}`,
      pre_gst: `₹${((breakdown.step_12_pre_gst_total_paise as number || 0) / 100).toFixed(2)}`,
      gst_18_percent: `₹${((breakdown.step_13_gst_paise as number || 0) / 100).toFixed(2)}`,
      grand_total: `₹${(snapshot.grand_total_paise / 100).toFixed(2)}`,
      grand_total_paise: snapshot.grand_total_paise,
    },
    terms: [
      'This quotation is valid for 30 days from the seal date.',
      'Prices include 18% GST.',
      'Payment terms: 100% advance before manufacturing.',
      'Installation timeline: as per schedule communicated separately.',
      'Any changes after quotation acceptance will require a revised quotation.',
    ],
    footer: {
      integrity_note: 'This quotation is cryptographically sealed. Any modification invalidates the integrity hash above.',
      hash: snapshot.sha256_hash,
    },
  };

  return success({
    pdf_data: pdfData,
    message: 'Quotation PDF data generated. Pass this to your PDF renderer.',
    note: 'For actual PDF file output, integrate with a rendering service (Puppeteer, wkhtmltopdf, or React-PDF).',
  });
}
