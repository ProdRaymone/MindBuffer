import { NextResponse } from 'next/server';
import { createServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

// ---------- PATCH: update single entry ----------
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const allowed = ['text', 'category', 'tags', 'attachments', 'processed'];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in body) patch[k] = body[k];
  }

  const { data, error } = await supabase
    .from('entries')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data });
}

// ---------- DELETE: delete single entry (also removes attached files) ----------
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Fetch entry first to get attachment paths
  const { data: entry } = await supabase
    .from('entries')
    .select('attachments')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  // Delete storage objects if any
  const attachments = (entry?.attachments as any[]) || [];
  const imagePaths = attachments
    .filter((a) => a.type === 'image' && a.storage_path)
    .map((a) => a.storage_path);
  const audioPaths = attachments
    .filter((a) => a.type === 'audio' && a.storage_path)
    .map((a) => a.storage_path);

  if (imagePaths.length > 0) {
    await supabase.storage.from('entries-images').remove(imagePaths);
  }
  if (audioPaths.length > 0) {
    await supabase.storage.from('entries-audio').remove(audioPaths);
  }

  const { error } = await supabase
    .from('entries')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
