/**
 * Mobile number encryption/decryption utilities.
 * 
 * Encryption decision (AD-17):
 * - Algorithm: AES-256-GCM (authenticated encryption)
 * - Key source: MOBILE_ENCRYPTION_KEY environment variable (32-byte hex string)
 * - Key management: Supabase secrets (not in code, not in config.toml)
 * - Encryption happens in Edge Functions (not pgcrypto) because:
 *   1. Key never touches the database — DB-level access can't decrypt
 *   2. Supabase Dashboard SQL queries can't read plaintext mobile
 *   3. Only Edge Functions with the env secret can encrypt/decrypt
 *   4. This matches the spec's intent: mobile_encrypted is opaque at rest
 * 
 * Format: IV (12 bytes) || ciphertext || auth tag (16 bytes), stored as bytea.
 * IV is generated fresh per encryption (never reused).
 * 
 * Who can decrypt:
 * - Edge Functions (via MOBILE_ENCRYPTION_KEY env var)
 * - NOT: Supabase Dashboard, direct SQL, any DB-level access
 * - This means: GET /leads/:id must go through the Edge Function to show mobile
 * 
 * Hash (for dedup/search):
 * - SHA-256 of the plaintext mobile (deterministic, no key needed)
 * - Stored in mobile_hash for uniqueness constraint and duplicate detection
 * - NOT reversible to plaintext (one-way)
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
 * Compute SHA-256 hash of a mobile number (for dedup/search via mobile_hash).
 * Deterministic, no key needed. NOT reversible.
 */
export async function hashMobile(mobile: string): Promise<string> {
  const data = new TextEncoder().encode(mobile);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(hashBuffer));
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
