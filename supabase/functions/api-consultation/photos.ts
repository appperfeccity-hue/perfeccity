/**
 * Site Photos — Upload (register) and Delete
 *
 * POST /api/v1/projects/:id/photos — register a site photo
 *   Client uploads to Supabase Storage first, then calls this with the s3_key.
 *   Same pattern as GLB upload (AD-35).
 *
 * DELETE /api/v1/projects/:id/photos/:photo_id — soft-delete a photo
 *   Sets is_deleted = true (does not remove from Storage).
 *
 * GET /api/v1/projects/:id/photos — list non-deleted photos
 *
 * Required for: Stage 6 SITE_PHOTO_REQUIRED guard (at least 1 non-deleted photo).
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { success, error } from '../_shared/response.ts';
import { AuthContext } from '../_shared/middleware/rbac.ts';
import { requireProjectOwnership } from './sequencing.ts';

export async function handleListPhotos(
  admin: SupabaseClient,
  projectId: string,
  auth: AuthContext
): Promise<Response> {
  const ownership = await requireProjectOwnership(admin, projectId, auth.userId);
  if ('error' in ownership) return ownership.error;

  const { data, error: queryErr } = await admin
    .from('site_photographs')
    .select('photo_id, s3_key, uploaded_by, created_at')
    .eq('project_id', projectId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true });

  if (queryErr) return error('DB_ERROR', 'Failed to list photos', 500);

  return success({ project_id: projectId, photos: data || [], count: data?.length || 0 });
}

export async function handleUploadPhoto(
  admin: SupabaseClient,
  projectId: string,
  auth: AuthContext,
  body: { s3_key?: string; caption?: string }
): Promise<Response> {
  const ownership = await requireProjectOwnership(admin, projectId, auth.userId);
  if ('error' in ownership) return ownership.error;

  if (!body.s3_key) {
    return error('VALIDATION_ERROR', 's3_key is required (Storage path after upload)', 422, 's3_key');
  }

  const { data: photo, error: insertErr } = await admin
    .from('site_photographs')
    .insert({
      project_id: projectId,
      s3_key: body.s3_key,
      uploaded_by: auth.userId,
      is_deleted: false,
    })
    .select()
    .single();

  if (insertErr) {
    return error('DB_ERROR', 'Failed to register photo: ' + insertErr.message, 500);
  }

  return success({
    photo,
    message: 'Site photo registered successfully',
  }, 201);
}

export async function handleDeletePhoto(
  admin: SupabaseClient,
  projectId: string,
  photoId: string,
  auth: AuthContext
): Promise<Response> {
  const ownership = await requireProjectOwnership(admin, projectId, auth.userId);
  if ('error' in ownership) return ownership.error;

  // Verify photo belongs to this project
  const { data: existing } = await admin
    .from('site_photographs')
    .select('photo_id')
    .eq('photo_id', photoId)
    .eq('project_id', projectId)
    .eq('is_deleted', false)
    .single();

  if (!existing) {
    return error('PHOTO_NOT_FOUND', 'Photo not found in this project', 404);
  }

  // Soft delete
  const { error: updateErr } = await admin
    .from('site_photographs')
    .update({ is_deleted: true })
    .eq('photo_id', photoId);

  if (updateErr) {
    return error('DB_ERROR', 'Failed to delete photo', 500);
  }

  return success({ photo_id: photoId, message: 'Photo deleted' });
}
