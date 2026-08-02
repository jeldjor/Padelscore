-- Live migration version: 20260802165140.
alter table public.playdays
  add column if not exists duration_minutes integer;

alter table public.playdays
  drop constraint if exists playdays_duration_minutes_check;

alter table public.playdays
  add constraint playdays_duration_minutes_check
  check (duration_minutes is null or duration_minutes between 1 and 1440);

comment on column public.playdays.duration_minutes is
  'Optionele speelduur in minuten, los van begin- en eindtijd.';

alter table public.rsvps
  add column if not exists playing_since timestamptz;

update public.rsvps
set playing_since = coalesce(playing_since, updated_at, now())
where response = 'playing';

comment on column public.rsvps.playing_since is
  'Vast moment waarop de speler beschikbaar werd; bepaalt de eerlijke reservevolgorde.';

create table if not exists public.playday_slots (
  id uuid primary key default gen_random_uuid(),
  playday_id uuid not null references public.playdays(id) on delete cascade,
  court_number integer not null check (court_number between 1 and 20),
  slot_number smallint not null check (slot_number between 1 and 4),
  user_id uuid references public.profiles(id) on delete set null,
  paid boolean not null default false,
  payment_inherited_from uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (playday_id, court_number, slot_number)
);

comment on table public.playday_slots is
  'Vier vaste plekken per baan. De betaalstatus blijft aan de plek gekoppeld wanneer een reserve doorschuift.';

create unique index if not exists playday_slots_one_slot_per_user_idx
  on public.playday_slots (playday_id, user_id)
  where user_id is not null;

create index if not exists playday_slots_playday_court_idx
  on public.playday_slots (playday_id, court_number, slot_number);

create index if not exists rsvps_reserve_queue_idx
  on public.rsvps (playday_id, response, playing_since, id);

alter table public.playday_slots enable row level security;

revoke all on table public.playday_slots from anon, authenticated;
grant select on table public.playday_slots to authenticated;
grant update (paid) on table public.playday_slots to authenticated;
grant all on table public.playday_slots to service_role;

drop policy if exists playday_slots_read on public.playday_slots;
create policy playday_slots_read
on public.playday_slots
for select
to authenticated
using (private.is_active_user());

drop policy if exists playday_slots_host_payment_update on public.playday_slots;
create policy playday_slots_host_payment_update
on public.playday_slots
for update
to authenticated
using (
  private.is_active_user()
  and (
    public.is_admin()
    or exists (
      select 1
      from public.playdays p
      where p.id = playday_slots.playday_id
        and p.host_id = (select auth.uid())
    )
  )
)
with check (
  private.is_active_user()
  and (
    public.is_admin()
    or exists (
      select 1
      from public.playdays p
      where p.id = playday_slots.playday_id
        and p.host_id = (select auth.uid())
    )
  )
);

create or replace function private.stamp_rsvp_queue_time()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
begin
  if new.response = 'playing' then
    if tg_op = 'INSERT' then
      new.playing_since := now();
    elsif old.response is distinct from 'playing' then
      new.playing_since := now();
    elsif new.playing_since is null then
      new.playing_since := coalesce(old.playing_since, now());
    end if;
  else
    new.playing_since := null;
  end if;
  return new;
end;
$$;

revoke all on function private.stamp_rsvp_queue_time() from public, anon, authenticated;

drop trigger if exists rsvps_stamp_queue_time on public.rsvps;
create trigger rsvps_stamp_queue_time
before insert or update of response on public.rsvps
for each row execute function private.stamp_rsvp_queue_time();

create or replace function private.rebalance_playday_slots(p_playday_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_court_count integer;
  v_waiting integer;
  v_slot_id uuid;
  v_user_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_playday_id::text, 0));

  select p.court_count
  into v_court_count
  from public.playdays p
  where p.id = p_playday_id
  for update;

  if not found then
    return;
  end if;

  insert into public.playday_slots (playday_id, court_number, slot_number)
  select p_playday_id, courts.court_number, slots.slot_number
  from generate_series(1, v_court_count) as courts(court_number)
  cross join generate_series(1, 4) as slots(slot_number)
  on conflict (playday_id, court_number, slot_number) do nothing;

  update public.playday_slots s
  set user_id = null,
      assigned_at = null,
      payment_inherited_from = case when s.paid then s.user_id else null end,
      updated_at = now()
  where s.playday_id = p_playday_id
    and s.user_id is not null
    and not exists (
      select 1
      from public.rsvps r
      where r.playday_id = p_playday_id
        and r.user_id = s.user_id
        and r.response = 'playing'
    );

  loop
    select s.id
    into v_slot_id
    from public.playday_slots s
    where s.playday_id = p_playday_id
      and s.user_id is null
    order by s.court_number, s.slot_number
    limit 1;

    select r.user_id
    into v_user_id
    from public.rsvps r
    where r.playday_id = p_playday_id
      and r.response = 'playing'
      and not exists (
        select 1
        from public.playday_slots occupied
        where occupied.playday_id = p_playday_id
          and occupied.user_id = r.user_id
      )
    order by r.playing_since nulls last, r.updated_at, r.id
    limit 1;

    exit when v_slot_id is null or v_user_id is null;

    update public.playday_slots
    set user_id = v_user_id,
        assigned_at = now(),
        payment_inherited_from = case when paid then payment_inherited_from else null end,
        updated_at = now()
    where id = v_slot_id;
  end loop;

  select count(*)
  into v_waiting
  from public.rsvps r
  where r.playday_id = p_playday_id
    and r.response = 'playing'
    and not exists (
      select 1
      from public.playday_slots occupied
      where occupied.playday_id = p_playday_id
        and occupied.user_id = r.user_id
    );

  while v_waiting >= 4 and v_court_count < 20 loop
    v_court_count := v_court_count + 1;

    update public.playdays
    set court_count = v_court_count,
        updated_at = now()
    where id = p_playday_id;

    insert into public.playday_slots (playday_id, court_number, slot_number)
    select p_playday_id, v_court_count, slots.slot_number
    from generate_series(1, 4) as slots(slot_number)
    on conflict (playday_id, court_number, slot_number) do nothing;

    loop
      select s.id
      into v_slot_id
      from public.playday_slots s
      where s.playday_id = p_playday_id
        and s.court_number = v_court_count
        and s.user_id is null
      order by s.slot_number
      limit 1;

      select r.user_id
      into v_user_id
      from public.rsvps r
      where r.playday_id = p_playday_id
        and r.response = 'playing'
        and not exists (
          select 1
          from public.playday_slots occupied
          where occupied.playday_id = p_playday_id
            and occupied.user_id = r.user_id
        )
      order by r.playing_since nulls last, r.updated_at, r.id
      limit 1;

      exit when v_slot_id is null or v_user_id is null;

      update public.playday_slots
      set user_id = v_user_id,
          assigned_at = now(),
          payment_inherited_from = null,
          updated_at = now()
      where id = v_slot_id;
    end loop;

    select count(*)
    into v_waiting
    from public.rsvps r
    where r.playday_id = p_playday_id
      and r.response = 'playing'
      and not exists (
        select 1
        from public.playday_slots occupied
        where occupied.playday_id = p_playday_id
          and occupied.user_id = r.user_id
      );
  end loop;
end;
$$;

revoke all on function private.rebalance_playday_slots(uuid) from public, anon, authenticated;

create or replace function private.rebalance_slots_after_rsvp()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if tg_op = 'DELETE' then
    perform private.rebalance_playday_slots(old.playday_id);
    return old;
  end if;

  if tg_op = 'UPDATE' and old.playday_id is distinct from new.playday_id then
    perform private.rebalance_playday_slots(old.playday_id);
  end if;

  perform private.rebalance_playday_slots(new.playday_id);
  return new;
end;
$$;

revoke all on function private.rebalance_slots_after_rsvp() from public, anon, authenticated;

drop trigger if exists rsvps_rebalance_playday_slots on public.rsvps;
create trigger rsvps_rebalance_playday_slots
after insert or update or delete on public.rsvps
for each row execute function private.rebalance_slots_after_rsvp();

create or replace function private.sync_slots_after_playday_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if tg_op = 'UPDATE' and new.court_count < old.court_count then
    if exists (
      select 1
      from public.playday_slots s
      where s.playday_id = new.id
        and s.court_number > new.court_count
        and (s.user_id is not null or s.paid)
    ) then
      raise exception 'Een baan met spelers of een betaalde plek kan niet worden verwijderd.';
    end if;

    delete from public.playday_slots s
    where s.playday_id = new.id
      and s.court_number > new.court_count;
  end if;

  perform private.rebalance_playday_slots(new.id);
  return new;
end;
$$;

revoke all on function private.sync_slots_after_playday_change() from public, anon, authenticated;

drop trigger if exists playdays_sync_slots on public.playdays;
create trigger playdays_sync_slots
after insert or update of court_count on public.playdays
for each row execute function private.sync_slots_after_playday_change();

create or replace function private.stamp_slot_payment_change()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
begin
  new.updated_at := now();
  if old.paid and not new.paid then
    new.payment_inherited_from := null;
  elsif not old.paid and new.paid then
    new.payment_inherited_from := null;
  end if;
  return new;
end;
$$;

revoke all on function private.stamp_slot_payment_change() from public, anon, authenticated;

drop trigger if exists playday_slots_stamp_payment on public.playday_slots;
create trigger playday_slots_stamp_payment
before update of paid on public.playday_slots
for each row execute function private.stamp_slot_payment_change();

do $$
declare
  playday record;
begin
  for playday in select id from public.playdays loop
    perform private.rebalance_playday_slots(playday.id);
  end loop;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'playday_slots'
  ) then
    alter publication supabase_realtime add table public.playday_slots;
  end if;
end;
$$;
