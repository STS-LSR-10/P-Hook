-- Suggestions and comments from users to the admin ("เสนอแนะ" in the LINE chat, or the button in the
-- settings page). Server only (RLS on, no policies). The plan is kept as it was when they wrote, so the
-- admin sees who is asking for what. Deleting the account deletes what it sent. Additive and idempotent.
create table if not exists feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  plan       text not null check (plan in ('free', 'plus', 'ultimate')),
  body       text not null check (char_length(body) between 1 and 1000),
  source     text not null check (source in ('line', 'app')),
  created_at timestamptz not null default now()
);
create index if not exists feedback_created_idx on feedback (created_at desc);
alter table feedback enable row level security;
