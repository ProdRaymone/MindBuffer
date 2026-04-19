import { redirect } from 'next/navigation';
import { createServer } from '@/lib/supabase-server';
import MindBuffer from '@/components/MindBuffer';
import type { Entry, Digest } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = await createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [entriesRes, digestsRes] = await Promise.all([
    supabase
      .from('entries')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('digests')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  return (
    <MindBuffer
      initialEntries={(entriesRes.data as Entry[]) || []}
      initialDigests={(digestsRes.data as Digest[]) || []}
      userEmail={user.email || ''}
    />
  );
}
