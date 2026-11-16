-- SUHAIS profile lifecycle helpers.
-- Apply only after reviewing in the Supabase SQL Editor.
-- Creates a profile automatically for each newly registered Auth user.
create or replace function public.handle_new_suhuis_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_suhuis_auth_user_created on auth.users;
create trigger on_suhuis_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_suhuis_user();
revoke execute on function public.handle_new_suhuis_user() from public, anon, authenticated;

create or replace function public.set_suhuis_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_suhuis_updated_at();
revoke execute on function public.set_suhuis_updated_at() from public, anon, authenticated;

drop trigger if exists user_workspace_set_updated_at on public.user_workspace;
create trigger user_workspace_set_updated_at
  before update on public.user_workspace
  for each row execute function public.set_suhuis_updated_at();

drop trigger if exists youtube_connections_set_updated_at on public.youtube_connections;
create trigger youtube_connections_set_updated_at
  before update on public.youtube_connections
  for each row execute function public.set_suhuis_updated_at();
