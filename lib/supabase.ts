import {
  createBrowserClient,
} from '@supabase/ssr';

// ============================================================================
// Browser client (client components, "use client")
// ============================================================================
export function createBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
