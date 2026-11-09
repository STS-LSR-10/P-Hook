-- Early Bird: limited seats at a lower price. One seat per account, whichever plan or period.
-- A seat is reserved when checkout opens, confirmed when the payment arrives and given back when
-- the reservation goes unpaid. Server only (service role); idempotent.

create table if not exists early_bird_seats (
  plan    plan_tier not null check (plan <> 'free'),
  period  text      not null check (period in ('monthly', 'yearly')),
  total   int       check (total is null or total >= 0), -- null = no limit on seats
  primary key (plan, period)
);
alter table early_bird_seats enable row level security;

insert into early_bird_seats (plan, period, total) values
  ('starter', 'yearly', 500),
  ('starter', 'monthly', null),
  ('plus', 'yearly', 100),
  ('plus', 'monthly', 200),
  ('ultimate', 'yearly', 30),
  ('ultimate', 'monthly', 50)
on conflict do nothing;

create table if not exists early_bird_claims (
  user_id     uuid primary key references users(id) on delete cascade,
  plan        plan_tier not null check (plan <> 'free'),
  period      text      not null check (period in ('monthly', 'yearly')),
  status      text      not null default 'reserved' check (status in ('reserved', 'paid')),
  reserved_at timestamptz not null default now(),
  paid_at     timestamptz
);
create index if not exists early_bird_claims_offer_idx on early_bird_claims (plan, period, status);
alter table early_bird_claims enable row level security;

-- Reserve a seat; false when the offer is unknown, full, or the account already has a paid seat.
create or replace function claim_early_bird(p_user uuid, p_plan plan_tier, p_period text)
returns boolean
language plpgsql as $$
declare
  seats int;
  found_offer boolean;
  taken int;
begin
  select true, s.total into found_offer, seats
    from early_bird_seats s where s.plan = p_plan and s.period = p_period for update;
  if found_offer is not true then return false; end if;
  if exists (select 1 from early_bird_claims where user_id = p_user and status = 'paid') then
    return false;
  end if;
  -- check room first, so a full offer never costs the person the reservation they already hold
  select count(*) into taken from early_bird_claims
   where plan = p_plan and period = p_period and user_id <> p_user;
  if seats is not null and taken >= seats then return false; end if;
  delete from early_bird_claims where user_id = p_user and status = 'reserved';
  insert into early_bird_claims (user_id, plan, period) values (p_user, p_plan, p_period);
  return true;
end $$;

-- The payment arrived: the seat is now paid (kept even if the reservation had lapsed).
create or replace function confirm_early_bird(p_user uuid, p_plan plan_tier, p_period text)
returns void
language plpgsql as $$
begin
  insert into early_bird_claims (user_id, plan, period, status, paid_at)
  values (p_user, p_plan, p_period, 'paid', now())
  on conflict (user_id) do update
    set plan = excluded.plan, period = excluded.period, status = 'paid', paid_at = now()
    where early_bird_claims.status = 'reserved'; -- a seat already paid is never moved
end $$;

-- Give back reservations that were never paid. Returns how many. The checkout page expires after
-- 30 minutes, so seats are released a little later than that.
create or replace function release_early_bird(p_minutes int default 35)
returns int
language plpgsql as $$
declare
  n int;
begin
  delete from early_bird_claims
   where status = 'reserved' and reserved_at < now() - make_interval(mins => p_minutes);
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function claim_early_bird(uuid, plan_tier, text) from public, anon, authenticated;
revoke execute on function confirm_early_bird(uuid, plan_tier, text) from public, anon, authenticated;
revoke execute on function release_early_bird(int) from public, anon, authenticated;
