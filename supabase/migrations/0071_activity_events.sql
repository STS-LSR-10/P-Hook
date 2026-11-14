-- How much each part of the app is used, for the admin's "จำนวนการใช้งาน" tab. One row per use:
-- what it was and who did it (no content). Reminders and calendar buttons are written by the app;
-- notes and stored files by the triggers below; entries and new members are read from their own
-- tables. Additive; safe to run again (the backfill only runs into an empty table).
create table if not exists activity_events (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind ~ '^[a-z]+(_[a-z]+)?$'),
  user_id    uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists activity_events_time_idx on activity_events (created_at);
-- deleting a member sets their rows' user_id to null
create index if not exists activity_events_user_idx on activity_events (user_id);
alter table activity_events enable row level security;

create or replace function log_note_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into activity_events (kind, user_id, created_at) values ('note', new.user_id, new.created_at);
  return new;
end $$;
drop trigger if exists notes_activity on notes;
create trigger notes_activity after insert on notes
  for each row execute function log_note_activity();

-- a file counts once it is kept (rows start as 'pending' while the upload runs)
create or replace function log_file_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'ready' and (tg_op = 'INSERT' or old.status is distinct from 'ready') then
    insert into activity_events (kind, user_id)
    values (case when new.mime_type like 'image/%' then 'image' else 'file' end, new.user_id);
  end if;
  return new;
end $$;
drop trigger if exists stored_files_activity on stored_files;
create trigger stored_files_activity after insert or update of status on stored_files
  for each row execute function log_file_activity();

-- what was kept before this: reminders (the way they were set was not kept), notes and files
insert into activity_events (kind, user_id, created_at)
select k, user_id, created_at from (
  select case when group_id is null then 'reminder' else 'reminder_group' end as k, user_id, created_at
    from user_reminders
  union all
  select 'note', user_id, created_at from notes
  union all
  select case when mime_type like 'image/%' then 'image' else 'file' end, user_id, created_at
    from stored_files where status = 'ready'
) old
where not exists (select 1 from activity_events);

-- Uses and people per kind in [p_from, p_to), and per group of kinds ("reminder" for all of
-- reminder_*): kind is null on a group's row. Entries come from transactions (confirmed ones: a
-- cancelled import or a split slip leaves 'deleted' rows behind), new members from users.
create or replace function activity_summary(p_from timestamptz, p_to timestamptz)
returns table (grp text, kind text, uses bigint, people bigint)
language sql stable security definer set search_path = public as $$
  with uses as (
    select e.kind, e.user_id from activity_events e
     where e.created_at >= p_from and e.created_at < p_to
    union all
    select 'entry_' || t.source::text, t.user_id from transactions t
     where t.created_at >= p_from and t.created_at < p_to and t.status = 'confirmed'
    union all
    select 'newuser', u.id from users u where u.created_at >= p_from and u.created_at < p_to
  )
  select split_part(u.kind, '_', 1) as grp,
         case when grouping(u.kind) = 1 then null else u.kind end as kind,
         count(*) as uses,
         count(distinct u.user_id) as people
    from uses u
   group by grouping sets ((split_part(u.kind, '_', 1), u.kind), (split_part(u.kind, '_', 1)));
$$;
revoke execute on function activity_summary(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function log_note_activity() from public, anon, authenticated;
revoke execute on function log_file_activity() from public, anon, authenticated;
