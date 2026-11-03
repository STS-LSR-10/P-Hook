-- How a group's reminder reaches the group without paying for every member each time (a push to a
-- group counts once per member against the LINE account's monthly messages; a reply costs nothing):
--   1. from 5 minutes before to 5 minutes after its time, the first message anyone sends in the group
--      is answered with it (a free reply);
--   2. after that, it is pushed: to the people it tags, one by one, or to the group within the owner's
--      monthly allowance of group messages;
--   3. when the allowance is used up, it waits up to 12 hours for the next message in the group.
-- Also: who a reminder tags, so it can tag them for real. Additive and idempotent.

alter table user_reminders add column if not exists mentions jsonb;

-- Reminders past their time that could not be pushed, waiting for the next message in the group.
create table if not exists group_late_reminders (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references bot_groups(id) on delete cascade,
  body       text not null,
  repeat     text,
  mentions   jsonb,
  due_at     timestamptz not null,
  expires_at timestamptz not null
);
create index if not exists group_late_reminders_group_idx
  on group_late_reminders (group_id, expires_at);
alter table group_late_reminders enable row level security;

-- Use `p_amount` of `p_limit` at once (a push to a group of 20 uses 20). False when it would not fit.
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
   where user_id = p_user and kind = p_kind and month = p_month and used + p_amount <= p_limit;
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function refund_usage_amount(p_user uuid, p_kind text, p_month date, p_amount int)
returns void
language sql security invoker as $$
  update usage_counters set used = greatest(0, used - p_amount)
   where user_id = p_user and kind = p_kind and month = p_month;
$$;

revoke execute on function take_usage_amount(uuid, text, date, int, int)
  from public, anon, authenticated;
revoke execute on function refund_usage_amount(uuid, text, date, int)
  from public, anon, authenticated;

-- The cron takes a group's reminder only once its 5 minutes of waiting for a message are over.
-- Same body as 0051 with that one condition (and the same columns, so it can be replaced in place).
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
begin
  for r in
    select ur.id as rid, ur.user_id as uid, ur.body as rbody, ur.remind_at as rat,
           ur.repeat as rrep, u.line_user_id as rline, g.line_group_id as gline,
           ur.group_id is not null as ingroup,
           coalesce(g.is_active and g.owner_user_id = ur.user_id, false) as gopen
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
      step := case r.rrep when 'daily' then interval '1 day' when 'weekly' then interval '7 days' else interval '1 month' end;
      local_at := r.rat at time zone 'Asia/Bangkok';
      guard := 0;
      loop
        local_at := local_at + step;
        guard := guard + 1;
        exit when (local_at at time zone 'Asia/Bangkok') > p_now or guard > 1000;
      end loop;
      update user_reminders
        set remind_at = local_at at time zone 'Asia/Bangkok', last_sent_at = p_now
        where id = r.rid;
    end if;
    r_id := r.rid; r_user := r.uid; r_line := r.rline; r_body := r.rbody; r_repeat := r.rrep;
    r_group := r.gline; r_group_open := r.gopen;
    return next;
  end loop;
end $$;
revoke execute on function claim_due_reminders_with_groups(timestamptz, int)
  from public, anon, authenticated;

-- Someone wrote in the group: take its reminders whose time is within `p_window` of now (each once; a
-- repeating one moves to its next time) and those waiting since their push could not be sent. Only
-- while the ledger is open, and only reminders on its current owner's limits.
create or replace function take_group_reminders_near(
  p_line_group text, p_now timestamptz, p_window interval
)
returns table (r_body text, r_repeat text, r_mentions jsonb, r_due timestamptz, r_late boolean)
language plpgsql security invoker as $$
declare
  g record;
  r record;
  step interval;
  local_at timestamp;
  guard int;
begin
  select id, owner_user_id, is_active into g from bot_groups where line_group_id = p_line_group;
  if not found or not g.is_active then
    return;
  end if;

  for r in
    select ur.id as rid, ur.body as rbody, ur.remind_at as rat, ur.repeat as rrep,
           ur.mentions as rmen
    from user_reminders ur
    where ur.group_id = g.id and ur.user_id = g.owner_user_id and ur.status = 'active'
      and ur.remind_at between p_now - p_window and p_now + p_window
    order by ur.remind_at
    for update of ur skip locked
  loop
    if r.rrep is null then
      update user_reminders set status = 'done', last_sent_at = p_now where id = r.rid;
    else
      step := case r.rrep when 'daily' then interval '1 day' when 'weekly' then interval '7 days' else interval '1 month' end;
      local_at := r.rat at time zone 'Asia/Bangkok';
      guard := 0;
      loop
        local_at := local_at + step;
        guard := guard + 1;
        exit when (local_at at time zone 'Asia/Bangkok') > p_now or guard > 1000;
      end loop;
      update user_reminders
        set remind_at = local_at at time zone 'Asia/Bangkok', last_sent_at = p_now
        where id = r.rid;
    end if;
    r_body := r.rbody; r_repeat := r.rrep; r_mentions := r.rmen; r_due := r.rat; r_late := false;
    return next;
  end loop;

  for r in
    delete from group_late_reminders l
     where l.group_id = g.id and l.expires_at > p_now
    returning l.body, l.repeat, l.mentions, l.due_at
  loop
    r_body := r.body; r_repeat := r.repeat; r_mentions := r.mentions; r_due := r.due_at;
    r_late := true;
    return next;
  end loop;
end $$;
revoke execute on function take_group_reminders_near(text, timestamptz, interval)
  from public, anon, authenticated;
