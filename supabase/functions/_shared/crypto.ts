/**
 * Mobile number encryption/decryption + hashing utilities.
 * 
 * TWO KEYS REQUIRED (separate secrets, separate purposes):
 * 
 * 1. MOBILE_ENCRYPTION_KEY — AES-256-GCM symmetric encryption
 *    - Encrypts the mobile number for storage (mobile_encrypted:bytea)
 *    - Decryption only possible with this key (Edge Function only)
 *    - Rotation = re-encrypt all rows (no rotation path exists yet — AD-17)
 * 
 * 2. MOBILE_HASH_KEY — HMAC-SHA256 keyed hash
 *    - Produces deterministic hash for dedup/search (mobile_hash:varchar)
 *    - WITHOUT this key, plain SHA-256 of Indian mobiles is trivially reversible
 *      (~33 bits entropy, known prefix structure, precomputable in seconds)
 *    - HMAC makes reversal infeasible without the key
 *    - Rotation = recompute all hashes (same operational burden as encryption key)
 * 
 * Key management (AD-17):
 * - Both keys stored in Supabase secrets (`supabase secrets set`)
 * - NEVER in code, config.toml, .env files, or version control
 * - Generate with: openssl rand -hex 32 (one command per key)
 * - Keys are 64-char hex strings (32 bytes / 256 bits each)
 * 
 * Key rotation story (documented, not solved):
 * - No online rotation path exists for MVP
 * - Rotating MOBILE_ENCRYPTION_KEY: all mobile_encrypted rows become undecryptable
 *   until a migration re-encrypts them (decrypt with old key, re-encrypt with new)
 * - Rotating MOBILE_HASH_KEY: all mobile_hash values become stale
 *   (dedup lookups fail until a migration recomputes them)
 * - Both rotations require downtime or a dual-key window — Layer 2 operational work
 * - "No rotation plan yet" is a deliberate MVP acceptance, not a gap to discover later
 * 
 * Who can decrypt/hash:
 * - Edge Functions (have both keys via env vars)
 * - NOT: Supabase Dashboard, direct SQL, DB-level access, pgcrypto
 */

/**
 * Get the encryption key from environment.
 * Key must be a 64-char hex string (32 bytes / 256 bits).
 */
function getEncryptionKey(): Uint8Array {
  const keyHex = Deno.env.get('MOBILE_ENCRYPTION_KEY');
  if (!keyHex || keyHex.length !== 64) {
    throw new Error(
      'MOBILE_ENCRYPTION_KEY must be set as a 64-character hex string (256 bits). ' +
      'Generate with: openssl rand -hex 32'
    );
  }
  return hexToBytes(keyHex);
}

/**
 * Encrypt a mobile number. Returns bytes: IV (12) || ciphertext || tag (16).
 */
export async function encryptMobile(plaintext: string): Promise<Uint8Array> {
  const keyBytes = getEncryptionKey();
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  // Generate a fresh 12-byte IV for each encryption (never reuse!)
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  // Combine: IV || ciphertext (includes GCM auth tag appended by WebCrypto)
  const result = new Uint8Array(iv.length + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), iv.length);

  return result;
}

/**
 * Decrypt a mobile number from stored bytes (IV || ciphertext || tag).
 */
export async function decryptMobile(encrypted: Uint8Array): Promise<string> {
  const keyBytes = getEncryptionKey();
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // Extract IV (first 12 bytes) and ciphertext+tag (rest)
  const iv = encrypted.slice(0, 12);
  const ciphertext = encrypted.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Compute HMAC-SHA256 of a mobile number (for dedup/search via mobile_hash).
 * 
 * IMPORTANT: This is HMAC (keyed hash), NOT plain SHA-256.
 * 
 * Plain SHA-256 of a 10-digit Indian mobile number has ~33 bits of entropy
 * with known prefix structure (operator codes, state codes). A precomputed
 * rainbow table of all plausible +91XXXXXXXXXX numbers would reverse any
 * plain SHA-256 hash in seconds. HMAC with a secret key makes this infeasible
 * without the key — an attacker with DB read access sees opaque hashes they
 * can't reverse without MOBILE_HASH_KEY.
 * 
 * Key: MOBILE_HASH_KEY environment variable (separate from encryption key —
 * different purpose, different rotation implications, defense-in-depth).
 * 
 * Deterministic: same input + same key = same hash (required for dedup lookups).
 * NOT reversible without the key.
 */
export async function hashMobile(mobile: string): Promise<string> {
  const hashKeyHex = Deno.env.get('MOBILE_HASH_KEY');
  if (!hashKeyHex || hashKeyHex.length !== 64) {
    throw new Error(
      'MOBILE_HASH_KEY must be set as a 64-character hex string (256 bits). ' +
      'Generate with: openssl rand -hex 32. ' +
      'This is separate from MOBILE_ENCRYPTION_KEY (different purpose).'
    );
  }

  const keyBytes = hexToBytes(hashKeyHex);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const data = new TextEncoder().encode(mobile);
  const signature = await crypto.subtle.sign('HMAC', key, data);
  return bytesToHex(new Uint8Array(signature));
}

// ============================================================
// Helpers
// ============================================================

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
