-- ============================================================================
-- MindBuffer · Supabase Schema
-- Run this in Supabase Dashboard → SQL Editor.
-- Idempotent: safe to re-run.
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";

-- ---------- Preferences (1 row per user) ----------
create table if not exists public.preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  digest_enabled boolean not null default true,
  digest_time time not null default '23:00:00',
  digest_min_entries int not null default 5,
  weekly_summary boolean not null default false,
  custom_categories jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Entries ----------
create table if not exists public.entries (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text text,
  category text not null default 'idea',
  tags text[] not null default '{}',
  attachments jsonb not null default '[]'::jsonb,
  processed boolean not null default false,
  last_digest_id uuid,
  source text not null default 'web',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists entries_user_created_idx on public.entries(user_id, created_at desc);
create index if not exists entries_user_category_idx on public.entries(user_id, category);
create index if not exists entries_tags_idx on public.entries using gin(tags);
create index if not exists entries_text_idx on public.entries using gin(to_tsvector('simple', coalesce(text, '')));

-- ---------- Digests ----------
create table if not exists public.digests (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  entry_count int not null default 0,
  entry_ids uuid[] not null default '{}',
  period_start timestamptz,
  period_end timestamptz,
  kind text not null default 'daily',
  created_at timestamptz not null default now()
);

create index if not exists digests_user_created_idx on public.digests(user_id, created_at desc);

-- ---------- RLS ----------
alter table public.preferences enable row level security;
alter table public.entries enable row level security;
alter table public.digests enable row level security;

drop policy if exists "own_preferences" on public.preferences;
create policy "own_preferences" on public.preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own_entries" on public.entries;
create policy "own_entries" on public.entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own_digests" on public.digests;
create policy "own_digests" on public.digests
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Auto-create preferences on signup ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.preferences (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- updated_at trigger ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists entries_updated_at on public.entries;
create trigger entries_updated_at before update on public.entries
  for each row execute function public.set_updated_at();

drop trigger if exists preferences_updated_at on public.preferences;
create trigger preferences_updated_at before update on public.preferences
  for each row execute function public.set_updated_at();

-- ---------- Storage buckets (private) ----------
insert into storage.buckets (id, name, public) values ('entries-images', 'entries-images', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('entries-audio', 'entries-audio', false)
  on conflict (id) do nothing;

-- ---------- Storage RLS ----------
-- File path convention: {user_id}/{entry_id}/{filename}
drop policy if exists "own_images_read" on storage.objects;
create policy "own_images_read" on storage.objects for select
  using (bucket_id = 'entries-images' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "own_images_insert" on storage.objects;
create policy "own_images_insert" on storage.objects for insert
  with check (bucket_id = 'entries-images' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "own_images_delete" on storage.objects;
create policy "own_images_delete" on storage.objects for delete
  using (bucket_id = 'entries-images' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "own_audio_read" on storage.objects;
create policy "own_audio_read" on storage.objects for select
  using (bucket_id = 'entries-audio' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "own_audio_insert" on storage.objects;
create policy "own_audio_insert" on storage.objects for insert
  with check (bucket_id = 'entries-audio' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "own_audio_delete" on storage.objects;
create policy "own_audio_delete" on storage.objects for delete
  using (bucket_id = 'entries-audio' and auth.uid()::text = (storage.foldername(name))[1]);
