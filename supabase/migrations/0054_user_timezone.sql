-- A person's own time zone (users.timezone, Bangkok unless they chose another in settings) for what the
-- database counts by the clock: the next round of a repeating reminder, the days/weeks/months of the
-- analytics chart, and the months offered for erasing. A group's reminders stay in Bangkok for now.
-- Additive and idempotent: the chart and the months get a version that takes the zone from the app
-- (the zone that request counts in, so the buckets line up with the app's); the old ones stay for an
-- app that has not been deployed yet. The reminder claim is replaced in place (same columns).

-- p_tz: an IANA zone the app has checked (one it lists); empty or null is Bangkok.
create or replace function analytics_series(
  p_user uuid, p_from timestamptz, p_to timestamptz, p_bucket text, p_tz text
) returns table (bucket_start timestamptz, income numeric, expense numeric)
language sql stable security invoker as $$
  with z as (select coalesce(nullif(p_tz, ''), 'Asia/Bangkok') as tz)
  select
    (date_trunc(p_bucket, t.occurred_at at time zone z.tz) at time zone z.tz),
    coalesce(sum(t.amount) filter (where t.type = 'income'), 0),
    coalesce(sum(t.amount) filter (where t.type = 'expense'), 0)
  from transactions t, z
  where t.user_id = p_user
    and t.status = 'confirmed'
    and t.occurred_at >= p_from
    and t.occurred_at <  p_to
    and p_bucket in ('day', 'week', 'month')
  group by 1
  order by 1;
$$;

create or replace function months_with_data(p_user uuid, p_tz text)
returns table (month text, entries bigint, transfers bigint)
language sql stable security invoker as $$
  with z as (select coalesce(nullif(p_tz, ''), 'Asia/Bangkok') as tz)
  select m.month, coalesce(sum(m.e), 0)::bigint, coalesce(sum(m.t), 0)::bigint
  from (
    select to_char(t.occurred_at at time zone z.tz, 'YYYY-MM') as month, 1 as e, 0 as t
    from transactions t, z
    where t.id in (select x.id from erasable_entry_ids(p_user, null, null, true) x)
    union all
    select to_char(x.occurred_at at time zone z.tz, 'YYYY-MM'), 0, 1
    from transfers x, z where x.user_id = p_user
  ) m
  group by m.month
  order by m.month desc;
$$;

-- Same as 0053, with a personal reminder's next round counted in its owner's zone (the app only ever
-- saves a zone it lists, so the column is used as it is).
create or replace function claim_due_reminders_with_groups(p_now timestamptz, p_limit int)
returns table (
  r_id uuid, r_user uuid, r_line text, r_body text, r_repeat text, r_group text, r_group_open boolean
)
language plpgsql security invoker as $$
declare
  r record;
  step interval;
  local_at timestamp;
  guard int;
  tz text;
begin
  for r in
    select ur.id as rid, ur.user_id as uid, ur.body as rbody, ur.remind_at as rat,
           ur.repeat as rrep, u.line_user_id as rline, g.line_group_id as gline,
           ur.group_id is not null as ingroup,
           coalesce(g.is_active and g.owner_user_id = ur.user_id, false) as gopen,
           coalesce(nullif(u.timezone, ''), 'Asia/Bangkok') as utz
    from user_reminders ur
    join users u on u.id = ur.user_id
    left join bot_groups g on g.id = ur.group_id
    where ur.status = 'active' and ur.remind_at <= p_now
      and (ur.group_id is null or ur.remind_at <= p_now - interval '5 minutes')
    order by ur.remind_at
    limit p_limit
    for update of ur skip locked
  loop
    if r.rrep is null or (r.ingroup and not r.gopen) then
      update user_reminders set status = 'done', last_sent_at = p_now where id = r.rid;
    else
      tz := case when r.ingroup then 'Asia/Bangkok' else r.utz end;
      step := case r.rrep when 'daily' then interval '1 day' when 'weekly' then interval '7 days' else interval '1 month' end;
      local_at := r.rat at time zone tz;
      guard := 0;
      loop
        local_at := local_at + step;
        guard := guard + 1;
        exit when (local_at at time zone tz) > p_now or guard > 1000;
      end loop;
      update user_reminders
        set remind_at = local_at at time zone tz, last_sent_at = p_now
        where id = r.rid;
    end if;
    r_id := r.rid; r_user := r.uid; r_line := r.rline; r_body := r.rbody; r_repeat := r.rrep;
    r_group := r.gline; r_group_open := r.gopen;
    return next;
  end loop;
end $$;
revoke execute on function claim_due_reminders_with_groups(timestamptz, int)
  from public, anon, authenticated;
