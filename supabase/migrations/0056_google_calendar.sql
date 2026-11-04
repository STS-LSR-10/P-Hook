-- Google Calendar: someone who signs in with Google from a reminder's "เพิ่มลงปฏิทิน" page lets the
-- bot add that reminder (and later ones they choose) to their Google Calendar, and keep the event in
-- step when the reminder is changed or cancelled. Additive and idempotent.

-- One Google account per person. The refresh token is encrypted by the app (AES-GCM, key in the
-- GOOGLE_TOKEN_KEY secret) before it is stored: the database never holds it in the clear.
create table if not exists google_calendar_links (
  user_id uuid primary key references users(id) on delete cascade,
  email text,
  refresh_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- No policies: only the server (service role) reads or writes it, never the app's own client.
alter table google_calendar_links enable row level security;

-- The Google event a reminder was added as, to change or remove it with the reminder.
alter table user_reminders add column if not exists google_event_id text;
