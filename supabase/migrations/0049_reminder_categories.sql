-- The category of a reminder, picked on the reminders page. Reminders set in the chat, and those from
-- before this, have none. Additive and idempotent.
alter table user_reminders add column if not exists category text;
alter table user_reminders drop constraint if exists user_reminders_category_check;
alter table user_reminders add constraint user_reminders_category_check
  check (category is null or category in ('bill', 'work', 'health', 'family'));
