-- How a person types an entry (amount before or after the name, Thai digits, "k", "พัน", "บาท"),
-- kept as counts only: nothing they wrote is stored. The AI reads it as a short hint, and the person
-- can switch it off and clear it in settings. Additive and idempotent.
create table if not exists user_style (
  user_id uuid primary key references users(id) on delete cascade,
  habits jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
-- No policies: only the server (service role) reads or writes it.
alter table user_style enable row level security;
