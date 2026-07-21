# GLB Asset Upload — Frontend/Backend Contract

## Ownership Split

| Step | Owner | Implementation |
|------|-------|---------------|
| 1. File selection UI | Frontend | File picker, validate `.glb` extension + size limit |
| 2. Upload to Supabase Storage | Frontend | `supabase.storage.from('design-assets').upload(path, file)` |
| 3. Register metadata | Backend (Edge Function) | `POST /api/v1/design-library/:id/glb` |
| 4. Validation check 2 (GLB exists) | Backend (Edge Function) | `POST /api/v1/design-library/:id/validate` |

## Frontend Contract

After uploading to Storage, the frontend MUST call:

```
POST /api/v1/design-library/:template_id/glb
Authorization: Bearer <designer-or-admin-jwt>
Content-Type: application/json

{
  "s3_key": "design-assets/templates/<template_id>/model.glb",
  "asset_type": "GLB"   // or "RENDER" for thumbnail images
}
```

### Response (201)
```json
{
  "data": {
    "asset": { "asset_id": "...", "template_id": "...", "asset_type": "GLB", "s3_key": "...", "is_active": true },
    "message": "GLB asset registered successfully"
  },
  "errors": []
}
```

### Error Cases
| Code | HTTP | When |
|------|------|------|
| `TEMPLATE_NOT_FOUND` | 404 | Template ID doesn't exist |
| `TEMPLATE_NOT_EDITABLE` | 422 | Template is not DRAFT |
| `FORBIDDEN` | 403 | Designer trying to upload to someone else's template |
| `VALIDATION_ERROR` | 422 | Missing `s3_key` or invalid `asset_type` |

## Behavior Notes

- Registering a new GLB **deactivates** the previous GLB for that template (only one active GLB at a time)
- Same applies to RENDER thumbnails
- The Storage bucket name should be `design-assets` (create if not exists)
- Storage path convention: `design-assets/templates/{template_id}/{filename}`
- The backend does NOT validate that the file actually exists in Storage — it trusts the `s3_key`. If the frontend passes a bad key, Check 2 will still pass (row exists with `is_active=true`), but the viewer will 404 when trying to load the GLB. This is acceptable for MVP — post-MVP, add a Storage.exists() check.

## Why This Split

Edge Functions have a 2MB request body limit and no native multipart/form-data parsing. Supabase Storage has a client SDK that handles chunked uploads, resumability, and direct-to-bucket auth. The metadata registration endpoint is a lightweight JSON call after the heavy upload completes.
