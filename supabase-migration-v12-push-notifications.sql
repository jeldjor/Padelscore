-- WEPADEL v3.13.0 - pushmeldingen en badges
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

create table if not exists public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null,
  dedupe_key text not null,
  sent_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  unique(user_id,dedupe_key)
);
create index if not exists notification_log_recent_idx on public.notification_log(user_id,notification_type,sent_at desc);

alter table public.push_subscriptions enable row level security;
alter table public.notification_log enable row level security;

drop policy if exists push_subscriptions_own_select on public.push_subscriptions;
create policy push_subscriptions_own_select on public.push_subscriptions for select using (auth.uid()=user_id);
drop policy if exists push_subscriptions_own_insert on public.push_subscriptions;
create policy push_subscriptions_own_insert on public.push_subscriptions for insert with check (auth.uid()=user_id);
drop policy if exists push_subscriptions_own_update on public.push_subscriptions;
create policy push_subscriptions_own_update on public.push_subscriptions for update using (auth.uid()=user_id) with check (auth.uid()=user_id);
drop policy if exists push_subscriptions_own_delete on public.push_subscriptions;
create policy push_subscriptions_own_delete on public.push_subscriptions for delete using (auth.uid()=user_id);

-- De log is alleen voor de serverfunctie; spelers hoeven deze tabel niet rechtstreeks te lezen.
revoke all on public.notification_log from anon, authenticated;
grant select,insert,update,delete on public.push_subscriptions to authenticated;

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Controleer ieder uur. De Edge Function verstuurt per speler maximaal één betaalherinnering per 48 uur.
do $$ begin
  perform cron.unschedule('wepadel-payment-reminders');
exception when others then null; end $$;
select cron.schedule(
  'wepadel-payment-reminders',
  '17 * * * *',
  $cron$select net.http_post(
    url := 'https://zikkxlwskskskykbxbvy.supabase.co/functions/v1/push-notifications',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','xGA_WLGGtx6zaCNh3O3M6CvcIHlxj-Ji35wmgHJHx-I'),
    body := '{"action":"reminders"}'::jsonb
  );$cron$
);
notify pgrst, 'reload schema';
