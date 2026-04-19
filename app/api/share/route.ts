import { NextResponse } from 'next/server';
import { createServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

// ============================================================================
// POST /api/share
// Endpoint declared in manifest.json as share_target.
// Android: when user shares from another app → PWA receives here.
// iOS: reached via Shortcuts (see docs/ios-shortcut.md).
// ============================================================================
export async function POST(req: Request) {
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    // Not logged in — bounce to login with share data preserved as query
    const url = new URL(req.url);
    return NextResponse.redirect(`${url.origin}/login`);
  }

  // Web Share Target sends multipart/form-data
  const form = await req.formData();
  const title = (form.get('title') as string) || '';
  const text = (form.get('text') as string) || '';
  const urlShared = (form.get('url') as string) || '';

  // Compose text from parts
  const parts = [title, text, urlShared].filter(Boolean);
  const composed = parts.join('\n');

  // Determine category: link if there's a URL, note otherwise
  const category = urlShared ? 'link' : 'note';
  const attachments: any[] = [];

  // If URL present, create a link attachment skeleton (client will unfurl later via /api/link-preview on view)
  if (urlShared) {
    try {
      const u = new URL(urlShared);
      attachments.push({
        type: 'link',
        url: urlShared,
        title: title || undefined,
        site_name: u.hostname.replace(/^www\./, ''),
      });
    } catch { /* ignore invalid */ }
  }

  // Handle shared image files (Android multi-image share)
  const files = form.getAll('files') as File[];
  for (const file of files) {
    if (file && file.size > 0 && file.type.startsWith('image/')) {
      const ext = file.type.split('/')[1] || 'png';
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const path = `${user.id}/shared/${filename}`;
      const { error: uploadErr } = await supabase
        .storage
        .from('entries-images')
        .upload(path, file, { contentType: file.type });
      if (!uploadErr) {
        attachments.push({ type: 'image', storage_path: path });
      }
    }
  }

  await supabase.from('entries').insert({
    user_id: user.id,
    text: composed || null,
    category,
    attachments,
    source: 'share',
  });

  // Redirect back to main view
  const url = new URL(req.url);
  return NextResponse.redirect(`${url.origin}/?shared=1`);
}

// Allow GET fallback for simple URL-based shares
export async function GET(req: Request) {
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  const url = new URL(req.url);

  if (!user) {
    return NextResponse.redirect(`${url.origin}/login`);
  }

  const title = url.searchParams.get('title') || '';
  const text = url.searchParams.get('text') || '';
  const urlShared = url.searchParams.get('url') || '';

  const composed = [title, text, urlShared].filter(Boolean).join('\n');
  if (!composed) return NextResponse.redirect(`${url.origin}/`);

  const attachments: any[] = [];
  if (urlShared) {
    try {
      const u = new URL(urlShared);
      attachments.push({
        type: 'link',
        url: urlShared,
        title: title || undefined,
        site_name: u.hostname.replace(/^www\./, ''),
      });
    } catch { /* ignore */ }
  }

  await supabase.from('entries').insert({
    user_id: user.id,
    text: composed || null,
    category: urlShared ? 'link' : 'note',
    attachments,
    source: 'share',
  });

  return NextResponse.redirect(`${url.origin}/?shared=1`);
}
