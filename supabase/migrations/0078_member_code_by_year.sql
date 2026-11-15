-- Member code by sign-up order: the account stores "2610" (year 26, 10th person to join that year,
-- Bangkok time, no padding). The app shows it as PH-<plan letter><stored>, the letter (F/S/P/E)
-- following the plan in force, so it is not stored. Replaces the random codes of 0077; every
-- account is numbered again in order of created_at. Safe to run again.
create table if not exists member_counters (
  year smallint primary key,
  last int not null
);
alter table member_counters enable row level security;

create or replace function new_member_code()
returns text
language plpgsql volatile as $$
declare
  y smallint := (extract(year from (now() at time zone 'Asia/Bangkok'))::int % 100);
  n int;
begin
  insert into member_counters (year, last) values (y, 1)
  on conflict (year) do update set last = member_counters.last + 1
  returning last into n;
  return y::text || n::text;
end $$;

-- the old random codes (PH-XXXX-XXXX) are numbered again; codes already in the new form stay
with ordered as (
  select id,
         (extract(year from (created_at at time zone 'Asia/Bangkok'))::int % 100) as y,
         row_number() over (
           partition by extract(year from (created_at at time zone 'Asia/Bangkok'))
           order by created_at, id
         ) as n
  from users
  where member_code !~ '^[0-9]+$'
)
update users u set member_code = ordered.y::text || (
  ordered.n + coalesce((select last from member_counters c where c.year = ordered.y), 0)
)::text
from ordered where u.id = ordered.id;

-- counters catch up with the highest number given in each year
insert into member_counters (year, last)
select substr(member_code, 1, 2)::smallint, max(substr(member_code, 3)::int)
from users where member_code ~ '^[0-9]{3,}$'
group by 1
on conflict (year) do update set last = greatest(member_counters.last, excluded.last);

revoke all on member_counters from public, anon, authenticated;
revoke execute on function new_member_code() from public, anon, authenticated;
