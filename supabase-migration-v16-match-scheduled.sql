-- WEPADEL v3.18.0
-- Zorgt dat nieuwe wedstrijden gepland kunnen worden aangemaakt.

alter table public.matches
  alter column started_at drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'match_status'
      and e.enumlabel = 'scheduled'
  ) then
    alter type public.match_status add value 'scheduled';
  end if;
end $$;

notify pgrst, 'reload schema';
