-- A chat message waiting for the person's answer: the AI was not sure which group it belongs to, or
-- it looks like a secret. Kept for 10 minutes because a LINE button holds too little text. One row per
-- person; a new one replaces it, so an older button stops working. Additive and idempotent. Server only
-- (RLS on, no policies).
create table if not exists pending_intents (
  user_id    uuid primary key references users(id) on delete cascade,
  id         uuid not null,
  input      text not null check (char_length(input) between 1 and 5000),
  decision   jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists pending_intents_expiry_idx on pending_intents (expires_at);
alter table pending_intents enable row level security;
