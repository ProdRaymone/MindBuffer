import { NextResponse } from 'next/server';
import { createServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

// ---------- GET: fetch preferences ----------
export async function GET() {
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('preferences')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ preferences: data });
}

// ---------- PATCH: update preferences ----------
export async function PATCH(req: Request) {
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const allowed = [
    'digest_enabled',
    'digest_time',
    'digest_min_entries',
    'weekly_summary',
    'custom_categories',
  ];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) patch[k] = body[k];

  const { data, error } = await supabase
    .from('preferences')
    .upsert({ user_id: user.id, ...patch })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ preferences: data });
}
