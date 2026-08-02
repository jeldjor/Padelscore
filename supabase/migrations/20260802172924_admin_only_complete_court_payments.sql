-- Only the competition administrator may change payment states.
-- Hosts and players retain read access so the status remains visible on a complete court.
drop policy if exists playday_slots_host_payment_update on public.playday_slots;
drop policy if exists playday_slots_admin_payment_update on public.playday_slots;

create policy playday_slots_admin_payment_update
on public.playday_slots
for update
to authenticated
using (
  private.is_active_user()
  and (select public.is_admin())
)
with check (
  private.is_active_user()
  and (select public.is_admin())
);
