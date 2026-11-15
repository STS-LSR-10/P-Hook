-- "What was this transfer for?": after a transfer slip the bot could not sort into a category, it asks,
-- and the person's next typed words (or a tap on a category) answer for that entry. One short-lived row
-- per user, like photo_waits. Server only (RLS on, no policies). Safe to run again.
create table if not exists slip_asks (
  user_id    uuid primary key references users(id) on delete cascade,
  tx_id      uuid not null references transactions(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table slip_asks enable row level security;
