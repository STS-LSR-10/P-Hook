-- Hourly reminders ("เตือน … ทุก 1 ชั่วโมง"): a personal reminder that repeats every hour, in rounds of
-- three. The third push of a round carries "เตือนต่อ / หยุด" buttons and waits 10 minutes for an answer:
-- "เตือนต่อ" starts three more rounds from the next hour, "หยุด" or no answer ends it. Each push counts
-- against the person's LINE reminder quota like any other. Safe to run again.
alter table user_reminders add column if not exists sent_rounds int not null default 0;
alter table user_reminders add column if not exists ask_until timestamptz;
alter table user_reminders add column if not exists resume_at timestamptz;

alter table user_reminders drop constraint if exists user_reminders_repeat_check;
alter table user_reminders add constraint user_reminders_repeat_check
  check (repeat in ('daily', 'weekly', 'monthly', 'hourly'));

-- Same as 0054, plus the hourly rounds. The signature stays (older migrations replace this function
-- when run again), so the third push of a round, the one with the buttons, says so in `r_repeat`:
-- 'hourly_ask' instead of 'hourly'.
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
  next_at timestamptz;
  rounds int;
begin
  for r in
    select ur.id as rid, ur.user_id as uid, ur.body as rbody, ur.remind_at as rat,
           ur.repeat as rrep, u.line_user_id as rline, g.line_group_id as gline,
           ur.group_id is not null as ingroup,
           coalesce(g.is_active and g.owner_user_id = ur.user_id, false) as gopen,
           coalesce(nullif(u.timezone, ''), 'Asia/Bangkok') as utz,
           ur.sent_rounds as sent, ur.ask_until as ask
    from user_reminders ur
    join users u on u.id = ur.user_id
    left join bot_groups g on g.id = ur.group_id
    where ur.status = 'active' and ur.remind_at <= p_now
      and (ur.group_id is null or ur.remind_at <= p_now - interval '5 minutes')
    order by ur.remind_at
    limit p_limit
    for update of ur skip locked
  loop
    r_repeat := r.rrep;
    if r.rrep = 'hourly' and not r.ingroup then
      if r.ask is not null then
        -- the 10 minutes ran out with no answer: it stops, nothing is sent
        update user_reminders set status = 'done', ask_until = null, resume_at = null where id = r.rid;
        continue;
      end if;
      rounds := r.sent + 1;
      -- the next whole hour after now, counted from the time it was set for
      next_at := r.rat + interval '1 hour' *
        (floor(extract(epoch from (p_now - r.rat)) / 3600)::int + 1);
      if rounds >= 3 then
        update user_reminders
          set sent_rounds = rounds, last_sent_at = p_now,
              ask_until = p_now + interval '10 minutes',
              remind_at = p_now + interval '10 minutes', resume_at = next_at
          where id = r.rid;
        r_repeat := 'hourly_ask';
      else
        update user_reminders
          set sent_rounds = rounds, last_sent_at = p_now, remind_at = next_at
          where id = r.rid;
      end if;
    elsif r.rrep is null or r.rrep = 'hourly' or (r.ingroup and not r.gopen) then
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
    r_id := r.rid; r_user := r.uid; r_line := r.rline; r_body := r.rbody;
    r_group := r.gline; r_group_open := r.gopen;
    return next;
  end loop;
end $$;
revoke execute on function claim_due_reminders_with_groups(timestamptz, int)
  from public, anon, authenticated;
