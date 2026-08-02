-- Online synchronization, active-account guard and automatic session approval.

create or replace function public.is_active_user()
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

revoke all on function public.is_active_user() from public, anon;
grant execute on function public.is_active_user() to authenticated;

create policy active_user_guard_competition on public.competition
as restrictive for all to authenticated
using (public.is_active_user()) with check (public.is_active_user());
create policy active_user_guard_profiles on public.profiles
as restrictive for all to authenticated
using (public.is_active_user()) with check (public.is_active_user());
create policy active_user_guard_playdays on public.playdays
as restrictive for all to authenticated
using (public.is_active_user()) with check (public.is_active_user());
create policy active_user_guard_rsvps on public.rsvps
as restrictive for all to authenticated
using (public.is_active_user()) with check (public.is_active_user());
create policy active_user_guard_attendance on public.attendance
as restrictive for all to authenticated
using (public.is_active_user()) with check (public.is_active_user());
create policy active_user_guard_matches on public.matches
as restrictive for all to authenticated
using (public.is_active_user()) with check (public.is_active_user());
create policy active_user_guard_reviews on public.session_reviews
as restrictive for all to authenticated
using (public.is_active_user()) with check (public.is_active_user());

create policy attendance_self_delete
on public.attendance for delete to authenticated
using (user_id = (select auth.uid()));

create or replace function public.evaluate_session_reviews()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  participant_count integer;
  review_count integer;
  reject_count integer;
begin
  select count(*) into participant_count
  from public.attendance
  where playday_id = new.playday_id;

  select count(*), count(*) filter (where decision = 'reject')
  into review_count, reject_count
  from public.session_reviews
  where playday_id = new.playday_id;

  if participant_count > 0 and review_count >= participant_count then
    update public.playdays
    set
      session_status = case when reject_count >= 2 then 'host_review'::public.session_status else 'approved'::public.session_status end,
      status = 'closed'::public.playday_status,
      approved_at = case when reject_count < 2 then now() else null end
    where id = new.playday_id and session_status = 'review';
  end if;

  return new;
end;
$$;

revoke all on function public.evaluate_session_reviews() from public, anon, authenticated;

drop trigger if exists evaluate_session_reviews_after_write on public.session_reviews;
create trigger evaluate_session_reviews_after_write
after insert or update on public.session_reviews
for each row execute function public.evaluate_session_reviews();

do $$
declare
  table_name text;
begin
  foreach table_name in array array['profiles','playdays','rsvps','attendance','matches','session_reviews']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
