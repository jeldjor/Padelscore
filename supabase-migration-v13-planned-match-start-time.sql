-- WEPADEL v3.14.0
-- Geplande wedstrijden hebben nog geen starttijd.
alter table public.matches
  alter column started_at drop not null;

notify pgrst, 'reload schema';
