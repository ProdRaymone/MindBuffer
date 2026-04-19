import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

// ============================================================================
// Agent pull mode: your local Claude Code / Hermes polls this endpoint
// with a shared-secret token to fetch unprocessed entries + push updates back.
//
// Auth: Bearer token set in AGENT_PULL_TOKEN env var.
// Uses service-role client since the agent isn't a Supabase-logged-in user.
// YOU must provide ?user_id=... in queries so you scope to your own data.
//
// GET  /api/agent-pull?user_id=...&processed=false&limit=100
//      → { entries: [...] }
//
// PATCH /api/agent-pull  { user_id, ids, patch }
//      → { ok: true, count }
//
// POST /api/agent-pull/digest  { user_id, content, entry_ids, kind }
//      → { digest: {...} }   (separate route if needed; for now inline via PATCH)
// ============================================================================

function checkAuth(req: Request): boolean {
  const token = process.env.AGENT_PULL_TOKEN;
  if (!token) return false;
  const auth = req.headers.get('authorization') || '';
  return auth === `Bearer ${token}`;
}

export async function GET(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get('user_id');
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 });

  const processed = url.searchParams.get('processed');
  const since = url.searchParams.get('since');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);

  const supabase = createServiceRoleClient();
  let query = supabase
    .from('entries')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (processed !== null) query = query.eq('processed', processed === 'true');
  if (since) query = query.gte('created_at', since);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data });
}

export async function PATCH(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { user_id, ids, patch } = body;
  if (!user_id || !Array.isArray(ids)) {
    return NextResponse.json({ error: 'user_id and ids required' }, { status: 400 });
  }

  const allowed = ['processed', 'last_digest_id', 'category', 'tags'];
  const cleanPatch: Record<string, unknown> = {};
  for (const k of allowed) if (k in patch) cleanPatch[k] = patch[k];

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('entries')
    .update(cleanPatch)
    .in('id', ids)
    .eq('user_id', user_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, count: ids.length });
}

export async function POST(req: Request) {
  // Agent creates a digest on behalf of user.
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { user_id, content, entry_ids, kind } = await req.json();
  if (!user_id || !content) {
    return NextResponse.json({ error: 'user_id and content required' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data: digest, error } = await supabase
    .from('digests')
    .insert({
      user_id,
      content,
      entry_ids: entry_ids || [],
      entry_count: (entry_ids || []).length,
      kind: kind || 'agent',
      period_end: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (entry_ids?.length) {
    await supabase
      .from('entries')
      .update({ processed: true, last_digest_id: digest.id })
      .in('id', entry_ids)
      .eq('user_id', user_id);
  }

  return NextResponse.json({ digest });
}
