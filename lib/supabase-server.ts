import 'server-only';

import {
  createServerClient as createSupabaseServerClient,
  type SetAllCookies,
} from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

// ============================================================================
// Server client (server components, route handlers)
// Async because cookies() is async in Next 15+ and stable in 14.
// ============================================================================
export async function createServer() {
  const cookieStore = await cookies();
  return createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component context - setting cookies will be handled by middleware
          }
        },
      },
    }
  );
}

// ============================================================================
// Service-role client (server-only, bypasses RLS)
// Use for: agent-pull endpoint, cron jobs, admin scripts.
// NEVER expose to the client.
// ============================================================================
export function createServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}
