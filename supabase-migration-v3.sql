-- Run once in Supabase SQL Editor before using WEPADEL v3.0
alter table public.playdays add column if not exists cost_per_player numeric(8,2);
alter table public.playdays add column if not exists tikkie_url text not null default '';

-- Remove the obsolete “maybe” choice from existing data.
delete from public.rsvps where response::text = 'maybe';
