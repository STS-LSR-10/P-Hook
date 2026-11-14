-- Photos attached to entries count toward the person's storage space. Each photo's size is kept on
-- its entry (photos attached before this have none, so they count as 0), file_usage adds them to the
-- stored files, and file_reserve checks against the sum so a file cannot be saved into space the
-- photos already use. Safe to run again.
alter table transactions add column if not exists photo_bytes bigint;

create or replace function file_usage(p_user uuid)
returns bigint
language sql stable security invoker as $$
  select (
    coalesce((select sum(size_bytes) from stored_files where user_id = p_user), 0)
    + coalesce((select sum(photo_bytes) from transactions
                where user_id = p_user and photo_path is not null), 0)
  )::bigint;
$$;

create or replace function file_reserve(
  p_id uuid, p_user uuid, p_name text, p_mime text, p_size bigint, p_key text, p_capacity bigint,
  p_group uuid default null, p_saved_by text default null
)
returns boolean
language plpgsql security invoker as $$
declare used bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  used := file_usage(p_user);
  if used + p_size > p_capacity then
    return false;
  end if;
  insert into stored_files (id, user_id, name, mime_type, size_bytes, r2_key, group_id, saved_by)
  values (p_id, p_user, p_name, p_mime, p_size, p_key, p_group, p_saved_by);
  return true;
end $$;
revoke execute on function file_reserve(uuid, uuid, text, text, bigint, text, bigint, uuid, text)
  from public, anon, authenticated;
