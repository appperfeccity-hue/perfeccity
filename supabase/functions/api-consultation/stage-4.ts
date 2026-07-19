/**
 * Stage 4 — Space Selection
 *
 * PUT /api/v1/projects/:id/consultation/stage/4
 * Role: owning Consultant only
 * Requires: Stage 3 COMPLETED
 *
 * Full replacement semantics: all spaces submitted at once.
 * Three-layer primary wall enforcement:
 * 1. App layer: PRIMARY_WALL_REQUIRED, SECONDARY_LIMIT_EXCEEDED
 * 2. DB partial unique index (one_primary_wall_per_project)
 * 3. Stage completion gate: not COMPLETED without >=1 primary
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { success, error } from '../_shared/response.ts';
import { AuthContext } from '../_shared/middleware/rbac.ts';
import {
  requireProjectOwnership,
  requirePreviousStageComplete,
  markStageStatus,
} from './sequencing.ts';

const INVALID_SPACE_TYPES = [
  'TV_WALL', 'BEDROOM_WALL', 'WARDROBE', 'KITCHEN',
  'POOJA_WALL', 'STAIRCASE_WALL', 'BALCONY_WALL',
];

const VALID_SPACE_TYPES = [
  'TV_UNIT_WALL', 'LIVING_ROOM_FEATURE_WALL', 'BED_BACK_WALL',
  'HOME_ENTRANCE', 'MANDIR_CORNER', 'STUDY_WALL', 'PHOTO_WALL',
  'BATHROOM_WALL', 'DINING_WALL', 'VANITY_CORNER',
  'KIDS_ROOM_WALL', 'CUSTOM_SPACE',
];

const VALID_WALL_SHAPES = ['STRAIGHT', 'L_SHAPE', 'C_SHAPE'];

interface SpaceInput {
  space_type: string;
  wall_shape?: string;
  is_primary_wall: boolean;
  primary_parameter_value?: string;
  planning_notes?: string;
  width_mm?: number;
  height_mm?: number;
}

interface Stage4Body {
  spaces: SpaceInput[];
}

export async function handleStage4(
  admin: SupabaseClient,
  projectId: string,
  auth: AuthContext,
  body: Stage4Body
): Promise<Response> {
  // Gate 4: ownership check
  const ownership = await requireProjectOwnership(admin, projectId, auth.userId);
  if ('error' in ownership) return ownership.error;

  // Sequencing: Stage 3 must be complete
  const seqBlock = await requirePreviousStageComplete(admin, projectId, 4);
  if (seqBlock) return seqBlock;

  // Validate spaces array exists and is non-empty
  if (!body.spaces || !Array.isArray(body.spaces) || body.spaces.length === 0) {
    return error('VALIDATION_ERROR', 'At least one space is required', 422, 'spaces');
  }

  // Guard: max 5 spaces (1 primary + up to 4 secondary)
  if (body.spaces.length > 5) {
    return error(
      'SECONDARY_LIMIT_EXCEEDED',
      'Maximum 5 spaces allowed (1 primary + up to 4 secondary)',
      422, 'spaces'
    );
  }

  // Guard: exactly 1 primary wall
  const primaryCount = body.spaces.filter(s => s.is_primary_wall).length;
  if (primaryCount === 0) {
    return error(
      'PRIMARY_WALL_REQUIRED',
      'Exactly one space must be marked as the primary wall',
      422, 'is_primary_wall'
    );
  }
  if (primaryCount > 1) {
    return error(
      'PRIMARY_WALL_REQUIRED',
      'Only one space can be the primary wall (found ' + primaryCount + ')',
      422, 'is_primary_wall'
    );
  }

  // Validate each space
  for (let i = 0; i < body.spaces.length; i++) {
    const space = body.spaces[i];

    if (!space.space_type) {
      return error('VALIDATION_ERROR', `spaces[${i}].space_type is required`, 422, 'space_type');
    }
    if (INVALID_SPACE_TYPES.includes(space.space_type)) {
      return error(
        'INVALID_SPACE_TYPE',
        `'${space.space_type}' is not valid. Valid types: ${VALID_SPACE_TYPES.join(', ')}`,
        422, 'space_type'
      );
    }
    if (!VALID_SPACE_TYPES.includes(space.space_type)) {
      return error(
        'INVALID_SPACE_TYPE',
        `'${space.space_type}' is not valid. Valid types: ${VALID_SPACE_TYPES.join(', ')}`,
        422, 'space_type'
      );
    }
    if (space.wall_shape && !VALID_WALL_SHAPES.includes(space.wall_shape)) {
      return error(
        'VALIDATION_ERROR',
        `spaces[${i}].wall_shape must be one of: ${VALID_WALL_SHAPES.join(', ')}`,
        422, 'wall_shape'
      );
    }
  }

  // Atomic replacement: delete old + insert new in one transaction (AD-19).
  // Uses a Postgres RPC function to prevent the partial-failure state where
  // delete succeeds but insert fails, leaving zero spaces.
  const spacePayload = body.spaces.map(s => ({
    space_type: s.space_type,
    wall_shape: s.wall_shape || null,
    is_primary_wall: s.is_primary_wall,
    primary_parameter_value: s.primary_parameter_value || null,
    planning_notes: s.planning_notes || null,
    width_mm: s.width_mm || null,
    height_mm: s.height_mm || null,
  }));

  const { data: inserted, error: rpcError } = await admin.rpc('replace_project_spaces', {
    p_project_id: projectId,
    p_spaces: spacePayload,
  });

  if (rpcError) {
    // Check for specific constraint violations
    if (rpcError.message?.includes('one_primary_wall_per_project')) {
      return error(
        'PRIMARY_WALL_REQUIRED',
        'DB constraint: only one primary wall allowed per project (concurrent conflict)',
        422, 'is_primary_wall'
      );
    }
    if (rpcError.message?.includes('space_type_enum')) {
      return error(
        'INVALID_SPACE_TYPE',
        'Invalid space type value rejected by database',
        422, 'space_type'
      );
    }
    // ⚠️ CO-MAINTENANCE: error messages from replace_project_spaces RPC
    console.error('Stage 4 replace_project_spaces RPC failed:', rpcError);
    return error('DB_ERROR', 'Failed to save spaces: ' + rpcError.message, 500);
  }

  // Mark Stage 4 as COMPLETED
  await markStageStatus(admin, projectId, 4, 'COMPLETED', auth.userId);

  return success({
    stage: 4,
    status: 'COMPLETED',
    spaces: inserted,
    summary: {
      total: inserted?.length || 0,
      primary: 1,
      secondary: (inserted?.length || 1) - 1,
    },
  });
}
