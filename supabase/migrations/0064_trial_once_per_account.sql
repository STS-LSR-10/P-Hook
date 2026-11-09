-- A free trial is once per account, whatever the tier (it was once per tier, which with four plans
-- allowed three trials in a row). Idempotent.
create or replace function start_plan_trial(p_user uuid, p_plan plan_tier, p_days int default 7)
returns timestamptz
language plpgsql as $$
declare
  cur plan_tier;
  exp timestamptz;
begin
  if p_plan = 'free' or p_days <= 0 then raise exception 'invalid_trial'; end if;
  select plan, plan_expires_at into cur, exp from users where id = p_user for update;
  if not found then raise exception 'unknown_user'; end if;
  if exp is not null and exp > now() then return null; end if;   -- a plan (paid, redeemed or trial) is running
  if cur <> 'free' and exp is null then return null; end if;      -- a plan without an end date
  if exists (select 1 from plan_trials where user_id = p_user) then return null; end if; -- tried before

  insert into plan_trials (user_id, plan) values (p_user, p_plan) on conflict do nothing;

  update users
     set plan = p_plan, plan_expires_at = now() + make_interval(days => p_days)
   where id = p_user
   returning plan_expires_at into exp;
  return exp;
end $$;
