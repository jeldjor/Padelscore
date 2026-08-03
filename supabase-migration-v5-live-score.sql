-- WEPADEL 3.6.0: live score per speeldag aan/uit
alter table public.playdays
  add column if not exists live_scoring_enabled boolean not null default true;
