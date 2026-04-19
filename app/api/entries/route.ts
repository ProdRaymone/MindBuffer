import { NextResponse } from 'next/server';
import { createServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

// ---------- GET: list entries ----------
export async function GET(req: Request) {
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const category = url.searchParams.get('category');
  const processed = url.searchParams.get('processed');
  const since = url.searchParams.get('since'); // ISO date
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '500'), 1000);
  const q = url.searchParams.get('q');

  let query = supabase
    .from('entries')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (category) query = query.eq('category', category);
  if (processed !== null) query = query.eq('processed', processed === 'true');
  if (since) query = query.gte('created_at', since);
  if (q) query = query.textSearch('text', q, { type: 'websearch' });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data });
}

// ---------- POST: create entry ----------
export async function POST(req: Request) {
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const { text, category, tags, attachments, source } = body;

  if (!text?.trim() && (!attachments || attachments.length === 0)) {
    return NextResponse.json({ error: 'entry must have text or attachments' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('entries')
    .insert({
      user_id: user.id,
      text: text?.trim() || null,
      category: category || 'idea',
      tags: tags || [],
      attachments: attachments || [],
      source: source || 'web',
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data });
}

// ---------- PATCH: batch update ----------
// Body: { ids: string[], patch: Partial<Entry> }
// Used by agent pull-mode to mark entries as processed.
export async function PATCH(req: Request) {
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { ids, patch } = await req.json();
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids required' }, { status: 400 });
  }

  // Whitelist allowed fields
  const allowed = ['processed', 'last_digest_id', 'category', 'tags'];
  const cleanPatch: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in patch) cleanPatch[k] = patch[k];
  }

  const { error } = await supabase
    .from('entries')
    .update(cleanPatch)
    .in('id', ids)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, count: ids.length });
}
