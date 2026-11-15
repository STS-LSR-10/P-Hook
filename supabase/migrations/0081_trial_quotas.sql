-- A free trial gets 1 in 5 of the plan's monthly limits on the things that cost us money per use
-- (voice, PDF, owl questions, ask-AI, group slip checks, pushes to a chat or a group). Same TRIAL_QUOTA_DIVISOR as the
-- app. It is a trial while the plan's end is still the trial's own 7 days (+1 h); a plan bought on top
-- ends later and gets the whole limit. Elite trials (no longer offered) keep their whole limits.
-- Same signatures as before, safe to run again.
create or replace function trial_limit(p_user uuid, p_kind text, p_limit int)
returns int
language sql stable security invoker as $$
  select case
    when p_limit > 0
     and p_kind in ('voice', 'pdf', 'owl', 'ai_chat', 'private_push', 'group_push', 'group_slip')
     and exists (
       select 1
         from users u join plan_trials t on t.user_id = u.id
        where u.id = p_user
          and t.plan <> 'ultimate'
          and u.plan_expires_at > now()
          and u.plan_expires_at <= t.started_at + interval '7 days 1 hour'
     )
    then greatest(1, ceil(p_limit / 5.0)::int)
    else p_limit
  end
$$;

create or replace function take_usage(p_user uuid, p_kind text, p_month date, p_limit int)
returns boolean
language plpgsql security invoker as $$
declare n int;
begin
  insert into usage_counters (user_id, kind, month) values (p_user, p_kind, p_month) on conflict do nothing;
  update usage_counters set used = used + 1
   where user_id = p_user and kind = p_kind and month = p_month
     and used < trial_limit(p_user, p_kind, p_limit);
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function take_usage_amount(
  p_user uuid, p_kind text, p_month date, p_amount int, p_limit int
)
returns boolean
language plpgsql security invoker as $$
declare n int;
begin
  insert into usage_counters (user_id, kind, month) values (p_user, p_kind, p_month)
    on conflict do nothing;
  update usage_counters set used = used + p_amount
   where user_id = p_user and kind = p_kind and month = p_month
     and used + p_amount <= trial_limit(p_user, p_kind, p_limit);
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke execute on function trial_limit(uuid, text, int) from public, anon, authenticated;
revoke execute on function take_usage(uuid, text, date, int) from public, anon, authenticated;
revoke execute on function take_usage_amount(uuid, text, date, int, int)
  from public, anon, authenticated;

-- Starting a trial gives a fresh fifth: what was used this month on Free does not count against it.
-- Same body as 0064 plus that one delete.
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
  if exp is not null and exp > now() then return null; end if;
  if cur <> 'free' and exp is null then return null; end if;
  if exists (select 1 from plan_trials where user_id = p_user) then return null; end if;

  insert into plan_trials (user_id, plan) values (p_user, p_plan) on conflict do nothing;

  delete from usage_counters
   where user_id = p_user
     and kind in ('voice', 'pdf', 'owl', 'ai_chat', 'private_push', 'group_push', 'group_slip')
     and month = date_trunc('month', now() at time zone 'Asia/Bangkok')::date;

  update users
     set plan = p_plan, plan_expires_at = now() + make_interval(days => p_days)
   where id = p_user
   returning plan_expires_at into exp;
  return exp;
end $$;
