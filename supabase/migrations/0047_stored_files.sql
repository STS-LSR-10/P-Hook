-- The file store: pictures, documents and videos a person keeps with พี่ฮูก. The bytes live in the private
-- R2 bucket phook-files; these rows hold the names and sizes. A file is 'pending' from the moment its
-- space is reserved until the bytes are written. file_waits: the next file sent should be kept.
-- recent_media: files sent a moment ago, so "เก็บไว้ให้หน่อย" can reach back for them. Additive and
-- idempotent. Server only (RLS on, no policies).
create table if not exists stored_files (
  id         uuid primary key,
  user_id    uuid not null references users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 200),
  mime_type  text not null,
  size_bytes bigint not null check (size_bytes > 0),
  r2_key     text not null unique,
  status     text not null default 'pending' check (status in ('pending', 'ready')),
  created_at timestamptz not null default now()
);
create index if not exists stored_files_user_idx on stored_files (user_id, created_at desc);
create index if not exists stored_files_status_idx on stored_files (status, created_at);
alter table stored_files enable row level security;

create table if not exists file_waits (
  user_id    uuid primary key references users(id) on delete cascade,
  name       text,
  expires_at timestamptz not null
);
alter table file_waits enable row level security;

create table if not exists recent_media (
  id         uuid primary key,
  user_id    uuid not null references users(id) on delete cascade,
  message_id text not null,
  kind       text not null check (kind in ('image', 'video', 'file')),
  file_name  text,
  file_size  bigint,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, message_id)
);
create index if not exists recent_media_expiry_idx on recent_media (expires_at);
alter table recent_media enable row level security;

-- Reserve space for one file (one person at a time, so files sent together cannot pass the capacity
-- between them). Pending rows count: their bytes may already be in the bucket.
create or replace function file_reserve(
  p_id uuid, p_user uuid, p_name text, p_mime text, p_size bigint, p_key text, p_capacity bigint
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
  insert into stored_files (id, user_id, name, mime_type, size_bytes, r2_key)
  values (p_id, p_user, p_name, p_mime, p_size, p_key);
  return true;
end $$;

revoke execute on function file_reserve(uuid, uuid, text, text, bigint, text, bigint)
  from public, anon, authenticated;
