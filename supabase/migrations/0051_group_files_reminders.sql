-- Files and reminders kept in a LINE group. They belong to the group's owner (user_id), so they take the
-- owner's space and the owner's reminder limits, and group_id keeps them apart from the owner's own:
-- a personal list never shows them. saved_by / created_by is the LINE id of the member who made it,
-- who may remove it (and so may the owner). Additive and idempotent.
alter table stored_files add column if not exists group_id uuid references bot_groups(id) on delete cascade;
alter table stored_files add column if not exists saved_by text;
create index if not exists stored_files_group_idx
  on stored_files (group_id, created_at desc) where group_id is not null;

alter table user_reminders add column if not exists group_id uuid references bot_groups(id) on delete cascade;
alter table user_reminders add column if not exists created_by text;
create index if not exists user_reminders_group_idx
  on user_reminders (group_id, remind_at) where group_id is not null;

-- "เก็บไฟล์" in a group: the next file this member sends there is kept. Server only.
create table if not exists group_file_waits (
  group_id     uuid not null references bot_groups(id) on delete cascade,
  line_user_id text not null,
  name         text,
  expires_at   timestamptz not null,
  primary key (group_id, line_user_id)
);
alter table group_file_waits enable row level security;

-- file_reserve gains the group (the space is still summed over everything the owner keeps). The old
-- form is dropped so a call that names only its arguments has one function to match.
drop function if exists file_reserve(uuid, uuid, text, text, bigint, text, bigint);
create or replace function file_reserve(
  p_id uuid, p_user uuid, p_name text, p_mime text, p_size bigint, p_key text, p_capacity bigint,
  p_group uuid default null, p_saved_by text default null
)
returns boolean
language plpgsql security invoker as $$
declare used bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  select coalesce(sum(size_bytes), 0) into used from stored_files where user_id = p_user;
  if used + p_size > p_capacity then
    return false;
  end if;
  insert into stored_files (id, user_id, name, mime_type, size_bytes, r2_key, group_id, saved_by)
  values (p_id, p_user, p_name, p_mime, p_size, p_key, p_group, p_saved_by);
  return true;
end $$;
revoke execute on function file_reserve(uuid, uuid, text, text, bigint, text, bigint, uuid, text)
  from public, anon, authenticated;

-- The space the owner's groups take, for the quota page ("ส่วนตัว X · กลุ่ม Y").
create or replace function file_usage_groups(p_user uuid)
returns bigint
language sql stable security invoker as $$
  select coalesce(sum(size_bytes), 0)::bigint
  from stored_files where user_id = p_user and group_id is not null;
$$;
revoke execute on function file_usage_groups(uuid) from public, anon, authenticated;

-- claim_due_reminders, saying also where a reminder goes: r_group is the LINE group id for one set in
-- a group (null for a personal one), and r_group_open is false when the bot has left that group, so it
-- is taken but not sent. A new name, because a function cannot change what it returns; the old one
-- stays for the code that runs until this version is deployed.
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
           coalesce(g.is_active, false) as gopen
    from user_reminders ur
    join users u on u.id = ur.user_id
    left join bot_groups g on g.id = ur.group_id
    where ur.status = 'active' and ur.remind_at <= p_now
    order by ur.remind_at
    limit p_limit
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
    r_id := r.rid; r_user := r.uid; r_line := r.rline; r_body := r.rbody; r_repeat := r.rrep;
    r_group := r.gline; r_group_open := r.gopen;
    return next;
  end loop;
end $$;
revoke execute on function claim_due_reminders_with_groups(timestamptz, int)
  from public, anon, authenticated;
