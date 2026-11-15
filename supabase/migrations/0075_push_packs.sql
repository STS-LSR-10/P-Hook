-- Packs of extra LINE pushes, bought once and never expiring: "private_push" (reminders to the
-- person's own chat) and "group_push" (messages the bot pushes into their groups). Like a slip pack
-- they count down in `remaining`; they are spent only after the plan's monthly allowance is used.
-- The alert boosters stop being sold (waiting reminders have no limit now); rows already bought stay.
-- Safe to run again.
alter table addons drop constraint if exists addons_kind_check;
alter table addons add constraint addons_kind_check
  check (kind in ('storage', 'alerts', 'slips', 'group_slots', 'private_push', 'group_push'));

-- Spend `p_amount` pushes from the person's packs of `p_kind`, oldest first. All or nothing: false
-- (and nothing spent) when the packs hold less.
create or replace function take_push_pack(p_user uuid, p_kind text, p_amount int)
returns boolean
language plpgsql as $$
declare
  have bigint;
  need int := p_amount;
  pack record;
  part int;
begin
  if p_kind not in ('private_push', 'group_push') or p_amount <= 0 then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || p_kind, 0));
  select coalesce(sum(remaining), 0) into have
    from addons where user_id = p_user and kind = p_kind and remaining > 0;
  if have < p_amount then return false; end if;
  for pack in
    select id, remaining from addons
     where user_id = p_user and kind = p_kind and remaining > 0
     order by created_at, id
     for update
  loop
    exit when need = 0;
    part := least(pack.remaining, need);
    update addons set remaining = remaining - part where id = pack.id;
    need := need - part;
  end loop;
  return true;
end $$;

-- Give pushes back (the message did not go out) to the packs that are not full, oldest first.
create or replace function refund_push_pack(p_user uuid, p_kind text, p_amount int)
returns void
language plpgsql as $$
declare
  back int := p_amount;
  pack record;
  part int;
begin
  if p_kind not in ('private_push', 'group_push') or p_amount <= 0 then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || p_kind, 0));
  for pack in
    select id, units, remaining from addons
     where user_id = p_user and kind = p_kind and remaining < units
     order by created_at, id
     for update
  loop
    exit when back = 0;
    part := least(pack.units - pack.remaining, back);
    update addons set remaining = remaining + part where id = pack.id;
    back := back - part;
  end loop;
end $$;

revoke execute on function take_push_pack(uuid, text, int) from public, anon, authenticated;
revoke execute on function refund_push_pack(uuid, text, int) from public, anon, authenticated;
