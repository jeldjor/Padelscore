-- Live migration version: 20260802165256.
create index if not exists playday_slots_user_idx
  on public.playday_slots (user_id)
  where user_id is not null;

create index if not exists playday_slots_payment_inherited_from_idx
  on public.playday_slots (payment_inherited_from)
  where payment_inherited_from is not null;
