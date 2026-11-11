-- HookCoins (ฮูกคอยน์): the referral bonus is paid to the referrer for at most 5 friends a month
-- (Bangkok months), counted from the ledger, and the amounts come from the app (now 5 and 5).
-- The other earnings (streaks, first slip, first budget, sharing) use award_points as it is: one per
-- (user, reason, ref). Safe to run again.
drop function if exists grant_referral_bonus(uuid, int, int);

create or replace function grant_referral_bonus(
  p_user uuid, p_referrer_bonus int, p_referee_bonus int, p_monthly_cap int default 5
) returns boolean
language plpgsql as $$
declare
  referrer uuid;
  granted boolean;
  used int;
begin
  select referred_by into referrer from users where id = p_user;
  if referrer is null then return false; end if;
  granted := award_points(p_user, p_referee_bonus, 'referral_welcome', p_user::text);
  if granted then
    -- two friends recording at once must not both slip under the cap
    perform 1 from users where id = referrer for update;
    select count(*) into used from point_ledger
     where user_id = referrer and reason = 'referral'
       and (created_at at time zone 'Asia/Bangkok')
           >= date_trunc('month', now() at time zone 'Asia/Bangkok');
    if used < p_monthly_cap then
      perform award_points(referrer, p_referrer_bonus, 'referral', p_user::text);
    end if;
  end if;
  return granted;
end $$;

revoke execute on function grant_referral_bonus(uuid, int, int, int) from public, anon, authenticated;
