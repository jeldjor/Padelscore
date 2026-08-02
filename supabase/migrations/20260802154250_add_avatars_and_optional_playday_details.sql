alter table public.profiles
  add column if not exists avatar_id smallint not null default 1;

alter table public.profiles
  drop constraint if exists profiles_avatar_id_check;

alter table public.profiles
  add constraint profiles_avatar_id_check
  check (avatar_id between 1 and 50);

alter table public.playdays
  add column if not exists time_enabled boolean not null default true,
  add column if not exists location_enabled boolean not null default true;

comment on column public.profiles.avatar_id is
  'Vaste WEPADEL-avatar uit de ingebouwde set van 50 transparante avatars.';

comment on column public.playdays.time_enabled is
  'Of start- en eindtijd van toepassing en zichtbaar zijn.';

comment on column public.playdays.location_enabled is
  'Of locatie van toepassing en zichtbaar is.';
