-- Move extension and privileged helper out of exposed public schema.

create schema if not exists extensions;
alter extension citext set schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and active = true
      and deleted_at is null
  )
$$;

revoke all on function private.is_active_user() from public, anon;
grant execute on function private.is_active_user() to authenticated;

drop policy if exists active_user_guard_competition on public.competition;
drop policy if exists active_user_guard_profiles on public.profiles;
drop policy if exists active_user_guard_playdays on public.playdays;
drop policy if exists active_user_guard_rsvps on public.rsvps;
drop policy if exists active_user_guard_attendance on public.attendance;
drop policy if exists active_user_guard_matches on public.matches;
drop policy if exists active_user_guard_reviews on public.session_reviews;

create policy active_user_guard_competition on public.competition
as restrictive for all to authenticated
using (private.is_active_user()) with check (private.is_active_user());
create policy active_user_guard_profiles on public.profiles
as restrictive for all to authenticated
using (private.is_active_user()) with check (private.is_active_user());
create policy active_user_guard_playdays on public.playdays
as restrictive for all to authenticated
using (private.is_active_user()) with check (private.is_active_user());
create policy active_user_guard_rsvps on public.rsvps
as restrictive for all to authenticated
using (private.is_active_user()) with check (private.is_active_user());
create policy active_user_guard_attendance on public.attendance
as restrictive for all to authenticated
using (private.is_active_user()) with check (private.is_active_user());
create policy active_user_guard_matches on public.matches
as restrictive for all to authenticated
using (private.is_active_user()) with check (private.is_active_user());
create policy active_user_guard_reviews on public.session_reviews
as restrictive for all to authenticated
using (private.is_active_user()) with check (private.is_active_user());

drop function if exists public.is_active_user();
