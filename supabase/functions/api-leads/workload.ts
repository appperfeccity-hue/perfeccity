/**
 * Consultant Workload View — T8
 * 
 * Returns active Consultants with their open consultation count.
 * Used by Manager during lead assignment to make informed decisions.
 * 
 * RLS NOTE (scrutinized per review):
 * This endpoint uses getAdminClient() (service_role, bypasses RLS) because:
 * 1. Manager's RLS on `users` table only allows reading their OWN record
 *    (users_self_read policy) — they can't see consultant names via RLS.
 * 2. The projects count is explicitly scoped in the query (WHERE status IN ...)
 *    rather than relying on RLS filtering — this makes the scoping visible
 *    and auditable in code rather than implicit.
 * 
 * This is NOT a "convenience bypass" — it's a deliberate architectural choice:
 * the Manager role needs to see consultant metadata (name, count) that their
 * row-level policy correctly denies for general-purpose access. The endpoint
 * exposes only the specific fields needed for assignment decisions.
 */

import { getAdminClient } from '../_shared/supabase.ts';
import { success, error } from '../_shared/response.ts';
import { AuthContext } from '../_shared/middleware/rbac.ts';

// Project statuses that count as "open consultation"
const OPEN_STATUSES = [
  'PROJECT_CREATED',
  'CONFIGURING',
  'REVIEWED',
  'QUOTED',
  'PAYMENT_PENDING',
];

export async function handleConsultantWorkload(auth: AuthContext): Promise<Response> {
  // Only Manager and Admin can see workload view (Part 9.2)
  if (auth.role !== 'MANAGER' && auth.role !== 'ADMIN') {
    return error('FORBIDDEN', 'Only Manager and Admin can view consultant workload', 403);
  }

  const admin = getAdminClient();

  // Get all active consultants (SALESPERSON role, ACTIVE status)
  const { data: consultants, error: consultantError } = await admin
    .from('users')
    .select('user_id, full_name, email')
    .eq('role', 'SALESPERSON')
    .eq('status', 'ACTIVE')
    .order('full_name', { ascending: true });

  if (consultantError) {
    console.error('Consultant query failed:', consultantError);
    return error('DB_ERROR', 'Failed to retrieve consultants', 500);
  }

  if (!consultants || consultants.length === 0) {
    return success([]);
  }

  // Get open project counts per consultant — explicitly scoped by status
  // (not relying on RLS bypass as implicit scoping)
  const consultantIds = consultants.map(c => c.user_id);

  const { data: projectCounts, error: countError } = await admin
    .from('projects')
    .select('consultant_id')
    .in('consultant_id', consultantIds)
    .in('status', OPEN_STATUSES);

  if (countError) {
    console.error('Project count query failed:', countError);
    return error('DB_ERROR', 'Failed to retrieve project counts', 500);
  }

  // Compute counts per consultant
  const countMap: Record<string, number> = {};
  for (const p of (projectCounts || [])) {
    countMap[p.consultant_id] = (countMap[p.consultant_id] || 0) + 1;
  }

  // Build response — only the fields needed for assignment decisions
  const result = consultants.map(c => ({
    user_id: c.user_id,
    full_name: c.full_name,
    email: c.email,
    open_consultation_count: countMap[c.user_id] || 0,
  }));

  return success(result);
}
