-- Add-on boosters: extra storage, waiting reminders, slip reads and LINE group slots bought on top
-- of a plan. Storage and group slots renew monthly (they carry an end date); reminder and slip packs
-- are bought once and never expire (a slip pack counts down in `remaining`). Server only; idempotent.

create table if not exists addons (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  kind       text not null check (kind in ('storage', 'alerts', 'slips', 'group_slots')),
  sku        text not null,
  -- GB for storage, items for alerts, slips for slips, groups for group_slots
  units      int  not null check (units > 0),
  -- slip packs only: reads left
  remaining  int  check (remaining is null or remaining >= 0),
  -- null = never expires
  expires_at timestamptz,
  -- the payment this came from, so a retried webhook adds it once
  source_ref text,
  created_at timestamptz not null default now()
);
create unique index if not exists addons_source_ref_key on addons (source_ref); -- nulls stay distinct
create index if not exists addons_user_idx on addons (user_id, kind);
alter table addons enable row level security;

-- Spend one read of a slip pack (the oldest with reads left). False when none is left.
create or replace function take_slip_pack(p_user uuid)
returns boolean
language plpgsql as $$
declare
  pack uuid;
begin
  select id into pack from addons
   where user_id = p_user and kind = 'slips' and remaining > 0
   order by created_at
   limit 1
   for update; -- a second read waits for the first, so two photos at once both get a read
  if pack is null then return false; end if;
  update addons set remaining = remaining - 1 where id = pack;
  return true;
end $$;

revoke execute on function take_slip_pack(uuid) from public, anon, authenticated;
