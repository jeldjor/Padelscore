-- WEPADEL v3.10.0
-- Legt automatisch de dag vast waarop een Tikkie-link in WEPADEL is ingevoerd.

alter table public.playdays
  add column if not exists tikkie_created_at date;

-- Bestaande links krijgen bij deze migratie vandaag als startdatum, omdat hun
-- oorspronkelijke invoerdatum niet meer betrouwbaar te achterhalen is.
update public.playdays
set tikkie_created_at = current_date
where nullif(trim(coalesce(tikkie_url, '')), '') is not null
  and tikkie_created_at is null;

-- Geen link betekent ook geen geldigheidsdatum.
update public.playdays
set tikkie_created_at = null
where nullif(trim(coalesce(tikkie_url, '')), '') is null;
