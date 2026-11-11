-- Paid Referral: when a referred friend makes their first real payment (amount above zero), the
-- referrer gets HookCoins and Pro days, and the friend gets the same days on top of what they bought.
-- Only the friend's first payment counts, once per friend (the coin award is keyed on the friend and
-- the friend's days are given only when that marker is new), and the referrer is paid (coins and days)
-- for at most p_monthly_cap friends a Bangkok month; the friend gets theirs either way.
--
-- The days extend plan_expires_at the way redeem_points does. A card subscriber is different: every
-- renewal sets plan_expires_at to the new period end (set_plan_until), which would swallow the days.
-- So for them the days are also kept in users.bonus_days, and set_plan_until puts them back after the
-- paid period. They are used up when the subscription stops renewing. Safe to run again.
alter table users add column if not exists bonus_days int not null default 0 check (bonus_days >= 0);

-- same as before (0010) plus: bonus days sit after the paid period; stale ones (the plan had ended) go
create or replace function set_plan_until(
  p_user uuid, p_plan plan_tier, p_until timestamptz, p_customer text, p_subscription text, p_period text
) returns timestamptz
language plpgsql as $$
declare
  exp timestamptz;
  owed int;
begin
  if p_period is not null and p_period not in ('monthly', 'yearly') then
    raise exception 'invalid_period';
  end if;
  select plan_expires_at, bonus_days into exp, owed from users where id = p_user for update;
  if exp is not null and exp < now() then owed := 0; end if;
  update users
     set plan = p_plan,
         plan_expires_at = greatest(coalesce(exp, p_until), p_until + make_interval(days => owed)),
         bonus_days = owed,
         stripe_customer_id = coalesce(p_customer, stripe_customer_id),
         stripe_subscription_id = coalesce(p_subscription, stripe_subscription_id),
         billing_period = coalesce(p_period, billing_period)
   where id = p_user
   returning plan_expires_at into exp;
  return exp;
end $$;

drop function if exists grant_paid_referral(uuid, text, int, int);
create or replace function grant_paid_referral(
  p_user uuid, p_ref text, p_referrer_coins int, p_days int, p_monthly_cap int default 5
) returns boolean
language plpgsql as $$
declare
  referrer uuid;
  this_at timestamptz;
  by_card boolean;
  used int;
  referrer_paid boolean;
begin
  select referred_by into referrer from users where id = p_user;
  if referrer is null then return false; end if;
  -- only a payment that really moved money counts (not a free trial or a 100% coupon)
  select created_at, coalesce(method, '') = 'card' into this_at, by_card from payments
   where user_id = p_user and provider_ref = p_ref and status = 'paid' and amount > 0;
  if this_at is null then return false; end if;
  -- and it must be their first one: a friend who was paying before the code was applied (or before
  -- this existed) does not pay out at their next renewal
  perform 1 from payments
   where user_id = p_user and amount > 0 and provider_ref <> p_ref and created_at < this_at;
  if found then return false; end if;

  -- both rows in a fixed order, so two rewards at once cannot wait on each other
  perform 1 from users where id in (referrer, p_user) order by id for update;
  -- the friend is rewarded once, whether or not the referrer still has room this month
  if not award_points(p_user, 0, 'paid_referral_buyer', p_user::text) then
    return false;
  end if;
  select count(*) into used from point_ledger
   where user_id = referrer and reason = 'paid_referral'
     and (created_at at time zone 'Asia/Bangkok')
         >= date_trunc('month', now() at time zone 'Asia/Bangkok');
  referrer_paid := used < p_monthly_cap
    and award_points(referrer, p_referrer_coins, 'paid_referral', p_user::text);

  -- stale bonus days (the plan had ended) are dropped before new ones are counted; a referrer's days
  -- are kept apart only while a card subscription is really running
  update users
     set bonus_days = (case when plan_expires_at is null or plan_expires_at < now() then 0 else bonus_days end)
           + case when id = p_user
                  then (case when by_card or stripe_subscription_id is not null then p_days else 0 end)
                  else (case when stripe_subscription_id is not null and plan_expires_at > now()
                             then p_days else 0 end) end,
         plan_expires_at = greatest(now(), coalesce(plan_expires_at, now())) + make_interval(days => p_days)
   where id = p_user or (id = referrer and referrer_paid);
  return true;
end $$;

revoke execute on function set_plan_until(uuid, plan_tier, timestamptz, text, text, text) from public, anon, authenticated;
revoke execute on function grant_paid_referral(uuid, text, int, int, int) from public, anon, authenticated;
