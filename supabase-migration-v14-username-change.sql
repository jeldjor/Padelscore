-- WEPADEL v3.15.0
-- Gebruikersnaam maximaal één keer per zes maanden wijzigen.
alter table public.profiles
  add column if not exists username_changed_at timestamptz;

create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(username));

notify pgrst, 'reload schema';
