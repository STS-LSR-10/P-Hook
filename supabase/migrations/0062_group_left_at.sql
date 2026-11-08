-- When the bot was taken out of a group (null: it was not, or the owner closed the ledger themselves).
-- The group's data is kept 30 days from then; after that it is deleted for good unless the owner has
-- opened the ledger again (which clears this). Additive and idempotent.
alter table bot_groups add column if not exists left_at timestamptz;
create index if not exists bot_groups_left_idx on bot_groups (left_at)
  where left_at is not null and not is_active;
