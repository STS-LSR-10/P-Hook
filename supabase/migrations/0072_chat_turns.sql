-- A short memory of a private chat with the bot, so it stays on the topic being talked about: the
-- last few messages each way, kept only while the chat goes on (10 minutes after the last one; the
-- 5-minute cron and every new message clear older ones). Additive and idempotent.
create table if not exists chat_turns (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references users(id) on delete cascade,
  role       text not null check (role in ('user', 'bot')),
  body       text not null check (char_length(body) between 1 and 600),
  created_at timestamptz not null default now()
);
create index if not exists chat_turns_user_idx on chat_turns (user_id, created_at desc);
create index if not exists chat_turns_time_idx on chat_turns (created_at);
alter table chat_turns enable row level security;
