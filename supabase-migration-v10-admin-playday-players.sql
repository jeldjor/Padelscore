-- WEPADEL v3.11.0
-- Beheerder kan bestaande spelers vooraf op een speeldag plaatsen,
-- verplaatsen of verwijderen. Force reserve voorkomt automatische baanplaatsing.

alter table public.rsvps
  add column if not exists force_reserve boolean not null default false;

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

  select p.court_count into v_court_count
  from public.playdays p
  where p.id = p_playday_id
  for update;
  if not found then return; end if;

  insert into public.playday_slots (playday_id, court_number, slot_number)
  select p_playday_id, c, s
  from generate_series(1, v_court_count) c
  cross join generate_series(1, 4) s
  on conflict (playday_id, court_number, slot_number) do nothing;

  update public.playday_slots s
  set user_id = null,
      assigned_at = null,
      payment_inherited_from = case when s.paid then s.user_id else null end,
      updated_at = now()
  where s.playday_id = p_playday_id
    and s.user_id is not null
    and not exists (
      select 1 from public.rsvps r
      where r.playday_id = p_playday_id
        and r.user_id = s.user_id
        and r.response = 'playing'
        and not coalesce(r.force_reserve,false)
    );

  loop
    select s.id into v_slot_id
    from public.playday_slots s
    where s.playday_id = p_playday_id and s.user_id is null
    order by s.court_number, s.slot_number limit 1;

    select r.user_id into v_user_id
    from public.rsvps r
    where r.playday_id = p_playday_id
      and r.response = 'playing'
      and not coalesce(r.force_reserve,false)
      and not exists (
        select 1 from public.playday_slots x
        where x.playday_id = p_playday_id and x.user_id = r.user_id
      )
    order by r.playing_since nulls last, r.updated_at, r.id limit 1;

    exit when v_slot_id is null or v_user_id is null;
    update public.playday_slots
    set user_id=v_user_id, assigned_at=now(),
        payment_inherited_from=case when paid then payment_inherited_from else null end,
        updated_at=now()
    where id=v_slot_id;
  end loop;

  select count(*) into v_waiting
  from public.rsvps r
  where r.playday_id=p_playday_id
    and r.response='playing'
    and not coalesce(r.force_reserve,false)
    and not exists (
      select 1 from public.playday_slots x
      where x.playday_id=p_playday_id and x.user_id=r.user_id
    );

  while v_waiting >= 4 and v_court_count < 20 loop
    v_court_count := v_court_count + 1;
    update public.playdays set court_count=v_court_count,updated_at=now() where id=p_playday_id;
    insert into public.playday_slots(playday_id,court_number,slot_number)
    select p_playday_id,v_court_count,s from generate_series(1,4) s
    on conflict (playday_id,court_number,slot_number) do nothing;

    loop
      select s.id into v_slot_id from public.playday_slots s
      where s.playday_id=p_playday_id and s.court_number=v_court_count and s.user_id is null
      order by s.slot_number limit 1;
      select r.user_id into v_user_id from public.rsvps r
      where r.playday_id=p_playday_id and r.response='playing'
        and not coalesce(r.force_reserve,false)
        and not exists(select 1 from public.playday_slots x where x.playday_id=p_playday_id and x.user_id=r.user_id)
      order by r.playing_since nulls last,r.updated_at,r.id limit 1;
      exit when v_slot_id is null or v_user_id is null;
      update public.playday_slots set user_id=v_user_id,assigned_at=now(),payment_inherited_from=null,updated_at=now() where id=v_slot_id;
    end loop;

    select count(*) into v_waiting from public.rsvps r
    where r.playday_id=p_playday_id and r.response='playing'
      and not coalesce(r.force_reserve,false)
      and not exists(select 1 from public.playday_slots x where x.playday_id=p_playday_id and x.user_id=r.user_id);
  end loop;
end;
$$;

revoke all on function private.rebalance_playday_slots(uuid) from public, anon, authenticated;

create or replace function public.admin_assign_playday_player(
  p_playday_id uuid,
  p_user_id uuid,
  p_placement text,
  p_court_number integer default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_slot_id uuid;
  v_max_courts integer;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin' and active) then
    raise exception 'Alleen de beheerder mag spelers plaatsen.';
  end if;
  if not exists(select 1 from public.profiles where id=p_user_id and active) then
    raise exception 'Speler niet gevonden of niet actief.';
  end if;
  select court_count into v_max_courts from public.playdays where id=p_playday_id for update;
  if v_max_courts is null then raise exception 'Speeldag niet gevonden.'; end if;

  insert into public.rsvps(playday_id,user_id,response,force_reserve)
  values(p_playday_id,p_user_id,'playing',p_placement='reserve')
  on conflict(playday_id,user_id) do update
    set response='playing', force_reserve=excluded.force_reserve, updated_at=now();

  perform private.rebalance_playday_slots(p_playday_id);

  if p_placement='reserve' then
    update public.playday_slots
    set user_id=null,assigned_at=null,updated_at=now()
    where playday_id=p_playday_id and user_id=p_user_id;
    return;
  end if;

  if p_placement<>'court' or p_court_number is null or p_court_number<1 or p_court_number>v_max_courts then
    raise exception 'Kies een geldige baan of de reservelijst.';
  end if;

  select id into v_slot_id from public.playday_slots
  where playday_id=p_playday_id and court_number=p_court_number and user_id is null
  order by slot_number limit 1 for update;
  if v_slot_id is null then raise exception 'Deze baan is al compleet.'; end if;

  update public.playday_slots set user_id=null,assigned_at=null,updated_at=now()
  where playday_id=p_playday_id and user_id=p_user_id;
  update public.playday_slots set user_id=p_user_id,paid=false,payment_inherited_from=null,assigned_at=now(),updated_at=now()
  where id=v_slot_id;
end;
$$;

create or replace function public.admin_remove_playday_player(p_playday_id uuid,p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin' and active) then
    raise exception 'Alleen de beheerder mag spelers verwijderen.';
  end if;
  update public.rsvps set response='not_playing',force_reserve=false,updated_at=now()
  where playday_id=p_playday_id and user_id=p_user_id;
  delete from public.attendance where playday_id=p_playday_id and user_id=p_user_id;
  perform private.rebalance_playday_slots(p_playday_id);
end;
$$;

revoke all on function public.admin_assign_playday_player(uuid,uuid,text,integer) from public, anon;
grant execute on function public.admin_assign_playday_player(uuid,uuid,text,integer) to authenticated;
revoke all on function public.admin_remove_playday_player(uuid,uuid) from public, anon;
grant execute on function public.admin_remove_playday_player(uuid,uuid) to authenticated;

notify pgrst, 'reload schema';
