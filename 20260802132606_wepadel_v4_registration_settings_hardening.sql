drop policy if exists registration_settings_no_direct_access on public.registration_settings;
create policy registration_settings_no_direct_access
  on public.registration_settings
  for all
  to anon, authenticated
  using (false)
  with check (false);
create index if not exists registration_settings_updated_by_idx
  on public.registration_settings(updated_by);
