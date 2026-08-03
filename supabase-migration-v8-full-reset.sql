-- WEPADEL 3.9.0: betrouwbare statistiekenreset en volledige testreset

create or replace function public.reset_all_statistics()
returns void
language plpgsql
security definer
set search_path=pg_catalog,public,private
as $$
declare
  v_competition_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Alleen de beheerder mag statistieken resetten.';
  end if;

  select competition_id into v_competition_id
  from public.profiles
  where id=auth.uid();

  delete from public.session_reviews
  where playday_id in (select id from public.playdays where competition_id=v_competition_id);

  delete from public.matches
  where playday_id in (select id from public.playdays where competition_id=v_competition_id);

  update public.playdays
  set session_status='open', review_started_at=null, approved_at=null
  where competition_id=v_competition_id;
end
$$;

grant execute on function public.reset_all_statistics() to authenticated;

create or replace function public.reset_competition_completely()
returns void
language plpgsql
security definer
set search_path=pg_catalog,public,private
as $$
declare
  v_competition_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Alleen de beheerder mag de competitie volledig resetten.';
  end if;

  select competition_id into v_competition_id
  from public.profiles
  where id=auth.uid();

  if v_competition_id is null then
    raise exception 'Competitie niet gevonden.';
  end if;

  -- Speeldagen verwijderen ruimt via de foreign keys ook wedstrijden,
  -- inschrijvingen, baanplekken, betalingen, beoordelingen en ruilverzoeken op.
  delete from public.playdays where competition_id=v_competition_id;

  -- Alleen het ingelogde beheerdersprofiel blijft bestaan.
  delete from public.profiles
  where competition_id=v_competition_id
    and id<>auth.uid();
end
$$;

grant execute on function public.reset_competition_completely() to authenticated;
