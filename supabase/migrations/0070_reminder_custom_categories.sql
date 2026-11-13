-- Reminder categories a person names themself, with one emoji. A reminder's `category` holds either a
-- built-in key ('bill', 'work', ...) or the id of one of these, so the old fixed list check goes;
-- the API checks the value instead. Additive and idempotent.
create table if not exists reminder_categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 20),
  emoji      text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now()
);
create index if not exists reminder_categories_user_idx on reminder_categories (user_id, created_at);
-- one name per person (two taps at once cannot make a pair)
create unique index if not exists reminder_categories_name_idx
  on reminder_categories (user_id, lower(name));
alter table reminder_categories enable row level security;

alter table user_reminders drop constraint if exists user_reminders_category_check;
alter table user_reminders add constraint user_reminders_category_check
  check (category is null or char_length(category) between 1 and 40);
