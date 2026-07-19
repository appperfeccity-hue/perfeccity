import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Sprint 1 tests are integration tests requiring a running Supabase instance.
    // Run with: npx vitest --run (not watch mode)
    include: ['tests/**/*.test.ts'],
    
    // CI CRITICAL: Tests must fail if crypto keys are missing.
    // Set these in CI environment (test-only keys, never production):
    //   MOBILE_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    //   MOBILE_HASH_KEY=fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210
    //   SUPABASE_URL=http://127.0.0.1:54321
    //   SUPABASE_ANON_KEY=<from supabase status>
    //   SUPABASE_SERVICE_ROLE_KEY=<from supabase status>
    
    // Test timeout: 30s per test (integration tests hit real DB)
    testTimeout: 30000,
  },
});
