import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://demfvizmxkuxvluopmtq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlbWZ2aXpteGt1eHZsdW9wbXRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0NTc5NzMsImV4cCI6MjEwMDAzMzk3M30.RSBWOWhUsnykZtzxWptNSW-uHRqpTkOpSZ-oGR5qEJU';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Call an Edge Function with proper auth headers.
 */
export async function callApi<T = unknown>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
  } = {}
): Promise<{ data: T | null; errors: Array<{ code: string; message: string }> }> {
  const { method = 'GET', body, token } = options;

  const session = await supabase.auth.getSession();
  const jwt = token || session.data.session?.access_token;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
  };
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`;

  const res = await fetch(`${SUPABASE_URL}/functions/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  return res.json();
}
