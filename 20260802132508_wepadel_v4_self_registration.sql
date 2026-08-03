-- WEPADEL v3.2.0 — gecontroleerde zelfregistratie
create extension if not exists pgcrypto with schema extensions;

alter table public.profiles
  add column if not exists approval_status text not null default 'approved',
  add column if not exists requested_at timestamptz;

update public.profiles
set approval_status = 'approved'
where approval_status is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_approval_status_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_approval_status_check
      check (approval_status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

create table if not exists public.registration_settings (
  competition_id uuid primary key references public.competition(id) on delete cascade,
  code_hash text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.registration_settings enable row level security;
revoke all on table public.registration_settings from anon, authenticated;

insert into public.registration_settings (competition_id, code_hash, enabled)
select id, encode(extensions.digest('WEPADEL-2026', 'sha256'), 'hex'), true
from public.competition
on conflict (competition_id) do nothing;

comment on column public.profiles.approval_status is
  'Zelfregistratie: pending tot een beheerder goedkeurt; bestaande en handmatig gemaakte accounts zijn approved.';
comment on table public.registration_settings is
  'Niet rechtstreeks toegankelijk vanuit de browser; alleen Edge Functions met service-role gebruiken de hash.';
