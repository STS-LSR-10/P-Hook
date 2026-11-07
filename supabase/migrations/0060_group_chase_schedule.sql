-- How often and when a group's unpaid bills are chased (the owner sets it in the settings page).
-- Defaults are what every group did before: every day, from 10:00. Additive and idempotent.
alter table bot_groups add column if not exists chase_every_days smallint not null default 1
  check (chase_every_days in (0, 1, 2, 3, 7));
alter table bot_groups add column if not exists chase_window text not null default 'any'
  check (chase_window in ('any', 'morning', 'noon', 'evening'));

-- True when this bill is due to be chased: never chased, or last chased p_every or more days before p_day.
drop function if exists split_bill_mark_reminded(uuid, date);
create or replace function split_bill_mark_reminded(p_bill uuid, p_day date, p_every int default 1)
returns boolean
language plpgsql security invoker as $$
declare n int;
begin
  update split_bills set last_reminded_on = p_day
   where id = p_bill and status = 'collecting'
     and (last_reminded_on is null or last_reminded_on <= p_day - greatest(p_every, 1));
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- server only, like the function it replaces (a new function is callable by everyone until revoked)
revoke execute on function split_bill_mark_reminded(uuid, date, int) from public, anon, authenticated;
