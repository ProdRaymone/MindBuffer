import { NextResponse } from 'next/server';
import { createServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

// ============================================================================
// POST /api/signed-url
// Body: { bucket: 'entries-images' | 'entries-audio', paths: string[] }
// Returns: { urls: Record<path, signed_url> }
//
// Storage RLS enforces path-based access (user_id folder), so we still verify
// the requesting user owns the paths by checking the folder prefix.
// ============================================================================
export async function POST(req: Request) {
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { bucket, paths } = await req.json();
  if (!bucket || !Array.isArray(paths)) {
    return NextResponse.json({ error: 'bucket and paths required' }, { status: 400 });
  }
  if (!['entries-images', 'entries-audio'].includes(bucket)) {
    return NextResponse.json({ error: 'invalid bucket' }, { status: 400 });
  }

  // Verify all paths belong to this user
  const ownedPaths = paths.filter(
    (p: string) => typeof p === 'string' && p.startsWith(`${user.id}/`)
  );

  const urls: Record<string, string> = {};
  for (const path of ownedPaths) {
    const { data } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600); // 1 hour
    if (data?.signedUrl) urls[path] = data.signedUrl;
  }

  return NextResponse.json({ urls });
}
