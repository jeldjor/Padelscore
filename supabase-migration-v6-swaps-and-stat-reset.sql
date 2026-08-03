-- WEPADEL 3.7.0: ruilverzoeken en statistieken resetten
create table if not exists public.swap_requests (
  id uuid primary key default gen_random_uuid(),
  playday_id uuid not null references public.playdays(id) on delete cascade,
  from_user_id uuid not null references public.profiles(id) on delete cascade,
  to_user_id uuid not null references public.profiles(id) on delete cascade,
  court_number integer not null,
  slot_number smallint not null,
  status text not null default 'pending' check (status in ('pending','accepted','rejected','cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create unique index if not exists swap_requests_one_pending_from_idx on public.swap_requests(playday_id,from_user_id) where status='pending';
alter table public.swap_requests enable row level security;
grant select on public.swap_requests to authenticated;
create policy swap_requests_read on public.swap_requests for select to authenticated
using (private.is_active_user() and (from_user_id=auth.uid() or to_user_id=auth.uid() or public.is_admin()));

create or replace function public.request_playday_swap(p_playday_id uuid,p_to_user_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_slot public.playday_slots%rowtype;
begin
 if not private.is_active_user() then raise exception 'Geen toegang.'; end if;
 select * into v_slot from public.playday_slots where playday_id=p_playday_id and user_id=auth.uid() for update;
 if not found then raise exception 'Je hebt geen vaste baanplek.'; end if;
 if (select count(*) from public.playday_slots where playday_id=p_playday_id and court_number=v_slot.court_number and user_id is not null)<>4 then raise exception 'Ruilen kan pas wanneer de baan compleet is.'; end if;
 if p_to_user_id=auth.uid() or exists(select 1 from public.playday_slots where playday_id=p_playday_id and user_id=p_to_user_id) then raise exception 'Deze speler is niet beschikbaar.'; end if;
 update public.swap_requests set status='cancelled',responded_at=now() where playday_id=p_playday_id and from_user_id=auth.uid() and status='pending';
 insert into public.swap_requests(playday_id,from_user_id,to_user_id,court_number,slot_number) values(p_playday_id,auth.uid(),p_to_user_id,v_slot.court_number,v_slot.slot_number);
end $$;
grant execute on function public.request_playday_swap(uuid,uuid) to authenticated;

create or replace function public.respond_playday_swap(p_request_id uuid,p_accept boolean)
returns void language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare r public.swap_requests%rowtype; v_paid boolean;
begin
 select * into r from public.swap_requests where id=p_request_id for update;
 if not found or r.to_user_id<>auth.uid() or r.status<>'pending' then raise exception 'Dit ruilverzoek is niet meer beschikbaar.'; end if;
 if not p_accept then update public.swap_requests set status='rejected',responded_at=now() where id=r.id; return; end if;
 if exists(select 1 from public.playday_slots where playday_id=r.playday_id and user_id=r.to_user_id) then raise exception 'Je hebt inmiddels al een baanplek.'; end if;
 select paid into v_paid from public.playday_slots where playday_id=r.playday_id and court_number=r.court_number and slot_number=r.slot_number and user_id=r.from_user_id for update;
 if not found then raise exception 'De oorspronkelijke plek bestaat niet meer.'; end if;
 update public.playday_slots set user_id=r.to_user_id,paid=v_paid,payment_inherited_from=case when v_paid then r.from_user_id else null end,assigned_at=now(),updated_at=now() where playday_id=r.playday_id and court_number=r.court_number and slot_number=r.slot_number;
 update public.rsvps set response='not_playing' where playday_id=r.playday_id and user_id=r.from_user_id;
 insert into public.rsvps(playday_id,user_id,response) values(r.playday_id,r.to_user_id,'playing') on conflict(playday_id,user_id) do update set response='playing';
 update public.matches set blue_player_1=case when blue_player_1=r.from_user_id then r.to_user_id else blue_player_1 end,blue_player_2=case when blue_player_2=r.from_user_id then r.to_user_id else blue_player_2 end,red_player_1=case when red_player_1=r.from_user_id then r.to_user_id else red_player_1 end,red_player_2=case when red_player_2=r.from_user_id then r.to_user_id else red_player_2 end where playday_id=r.playday_id and deleted_at is null;
 update public.swap_requests set status='accepted',responded_at=now() where id=r.id;
 update public.swap_requests set status='cancelled',responded_at=now() where playday_id=r.playday_id and status='pending' and id<>r.id and (from_user_id in(r.from_user_id,r.to_user_id) or to_user_id in(r.from_user_id,r.to_user_id));
end $$;
grant execute on function public.respond_playday_swap(uuid,boolean) to authenticated;

create or replace function public.reset_all_statistics()
returns void language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 if not public.is_admin() then raise exception 'Alleen de beheerder mag statistieken resetten.'; end if;
 delete from public.session_reviews;
 delete from public.matches;
 update public.playdays set session_status='open',review_started_at=null,approved_at=null where session_status is not null;
end $$;
grant execute on function public.reset_all_statistics() to authenticated;

do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='swap_requests') then alter publication supabase_realtime add table public.swap_requests; end if;
end $$;
