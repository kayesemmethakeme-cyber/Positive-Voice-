-- SUHAIS multi-user foundation
-- Apply in Supabase SQL Editor only after reviewing. RLS is enabled on every user-owned table.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.user_workspace (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_type text not null check (record_type in ('draft','history','settings','discovery')),
  record_key text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, record_type, record_key)
);
create index if not exists user_workspace_user_type_idx on public.user_workspace(user_id, record_type);
create table if not exists public.youtube_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  channel_id text,
  channel_title text,
  -- Tokens must be encrypted by the application before storage. Never expose this table via client APIs.
  encrypted_refresh_token text,
  token_key_version integer not null default 1,
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
alter table public.user_workspace enable row level security;
alter table public.youtube_connections enable row level security;
drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile" on public.profiles for select to authenticated using (auth.uid() = id);
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "Users insert own profile" on public.profiles;
create policy "Users insert own profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
drop policy if exists "Users manage own workspace" on public.user_workspace;
create policy "Users manage own workspace" on public.user_workspace for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- No client policies for youtube_connections: access only through trusted server-side service role.
revoke all on public.youtube_connections from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.user_workspace to authenticated;
grant usage on schema public to anon, authenticated;
