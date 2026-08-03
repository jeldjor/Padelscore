-- WEPADEL v3.16.0
-- Registreert wanneer een gebruiker voor het laatst succesvol heeft ingelogd.

alter table public.profiles
  add column if not exists last_login_at timestamptz;

create or replace function public.mark_login()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set last_login_at = now()
  where id = auth.uid();
$$;

revoke all on function public.mark_login() from public;
grant execute on function public.mark_login() to authenticated;

notify pgrst, 'reload schema';
