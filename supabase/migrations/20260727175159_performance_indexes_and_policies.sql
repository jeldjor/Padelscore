-- Cover foreign keys and consolidate permissive RLS policies.

create index if not exists attendance_user_idx on public.attendance(user_id);
create index if not exists playdays_competition_idx on public.playdays(competition_id);
create index if not exists playdays_host_idx on public.playdays(host_id);
create index if not exists rsvps_user_idx on public.rsvps(user_id);
create index if not exists reviews_user_idx on public.session_reviews(user_id);
create index if not exists matches_blue_player_1_idx on public.matches(blue_player_1);
create index if not exists matches_blue_player_2_idx on public.matches(blue_player_2);
create index if not exists matches_red_player_1_idx on public.matches(red_player_1);
create index if not exists matches_red_player_2_idx on public.matches(red_player_2);

drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_insert on public.profiles for insert to authenticated
with check (public.is_admin());
create policy profiles_admin_update on public.profiles for update to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy profiles_admin_delete on public.profiles for delete to authenticated
using (public.is_admin());

drop policy if exists attendance_self_insert on public.attendance;
drop policy if exists attendance_self_update on public.attendance;
drop policy if exists attendance_self_delete on public.attendance;
drop policy if exists attendance_host_manage on public.attendance;

create policy attendance_insert on public.attendance for insert to authenticated
with check (
  (user_id = (select auth.uid()) and status in ('present','ready'))
  or public.is_admin()
  or exists (
    select 1 from public.playdays p
    where p.id = playday_id and p.host_id = (select auth.uid())
  )
);

create policy attendance_update on public.attendance for update to authenticated
using (
  user_id = (select auth.uid())
  or public.is_admin()
  or exists (
    select 1 from public.playdays p
    where p.id = playday_id and p.host_id = (select auth.uid())
  )
)
with check (
  (user_id = (select auth.uid()) and status in ('present','ready'))
  or public.is_admin()
  or exists (
    select 1 from public.playdays p
    where p.id = playday_id and p.host_id = (select auth.uid())
  )
);

create policy attendance_delete on public.attendance for delete to authenticated
using (
  user_id = (select auth.uid())
  or public.is_admin()
  or exists (
    select 1 from public.playdays p
    where p.id = playday_id and p.host_id = (select auth.uid())
  )
);

drop policy if exists matches_host_manage on public.matches;
create policy matches_host_insert on public.matches for insert to authenticated
with check (
  public.is_admin()
  or exists (
    select 1 from public.playdays p
    where p.id = playday_id and p.host_id = (select auth.uid())
  )
);
create policy matches_host_update on public.matches for update to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.playdays p
    where p.id = playday_id and p.host_id = (select auth.uid())
  )
)
with check (
  public.is_admin()
  or exists (
    select 1 from public.playdays p
    where p.id = playday_id and p.host_id = (select auth.uid())
  )
);
create policy matches_host_delete on public.matches for delete to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.playdays p
    where p.id = playday_id and p.host_id = (select auth.uid())
  )
);

drop policy if exists reviews_self_insert on public.session_reviews;
drop policy if exists reviews_self_update on public.session_reviews;
drop policy if exists reviews_host_manage on public.session_reviews;

create policy reviews_insert on public.session_reviews for insert to authenticated
with check (
  (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.attendance a
      where a.playday_id = playday_id and a.user_id = (select auth.uid())
    )
  )
  or public.is_admin()
  or exists (
    select 1 from public.playdays p
    where p.id = playday_id and p.host_id = (select auth.uid())
  )
);

create policy reviews_update on public.session_reviews for update to authenticated
using (
  user_id = (select auth.uid())
  or public.is_admin()
  or exists (
    select 1 from public.playdays p
    where p.id = playday_id and p.host_id = (select auth.uid())
  )
)
with check (
  user_id = (select auth.uid())
  or public.is_admin()
  or exists (
    select 1 from public.playdays p
    where p.id = playday_id and p.host_id = (select auth.uid())
  )
);

create policy reviews_delete on public.session_reviews for delete to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.playdays p
    where p.id = playday_id and p.host_id = (select auth.uid())
  )
);
