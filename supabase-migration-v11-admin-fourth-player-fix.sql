-- WEPADEL v3.11.1
-- Herstelt handmatig plaatsen van de vierde speler op een baan.
-- De nieuwe speler wordt tijdens het herschikken tijdelijk als reserve behandeld,
-- zodat de automatische rebalance niet alvast de laatste vrije plek inneemt.

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

  select court_count into v_max_courts
  from public.playdays
  where id=p_playday_id
  for update;
  if v_max_courts is null then
    raise exception 'Speeldag niet gevonden.';
  end if;

  if p_placement not in ('court','reserve') then
    raise exception 'Kies een geldige baan of de reservelijst.';
  end if;
  if p_placement='court' and (p_court_number is null or p_court_number<1 or p_court_number>v_max_courts) then
    raise exception 'Kies een geldige baan of de reservelijst.';
  end if;

  -- Tijdelijk force_reserve=true voorkomt dat rebalance deze speler automatisch
  -- al in de laatste vrije plek zet voordat de gekozen baan wordt verwerkt.
  insert into public.rsvps(playday_id,user_id,response,force_reserve)
  values(p_playday_id,p_user_id,'playing',true)
  on conflict(playday_id,user_id) do update
    set response='playing', force_reserve=true, updated_at=now();

  update public.playday_slots
  set user_id=null, assigned_at=null, updated_at=now()
  where playday_id=p_playday_id and user_id=p_user_id;

  perform private.rebalance_playday_slots(p_playday_id);

  if p_placement='reserve' then
    return;
  end if;

  select id into v_slot_id
  from public.playday_slots
  where playday_id=p_playday_id
    and court_number=p_court_number
    and user_id is null
  order by slot_number
  limit 1
  for update;

  if v_slot_id is null then
    raise exception 'Deze baan is al compleet.';
  end if;

  update public.playday_slots
  set user_id=p_user_id,
      paid=false,
      payment_inherited_from=null,
      assigned_at=now(),
      updated_at=now()
  where id=v_slot_id;

  update public.rsvps
  set force_reserve=false, updated_at=now()
  where playday_id=p_playday_id and user_id=p_user_id;
end;
$$;

revoke all on function public.admin_assign_playday_player(uuid,uuid,text,integer) from public, anon;
grant execute on function public.admin_assign_playday_player(uuid,uuid,text,integer) to authenticated;

notify pgrst, 'reload schema';
