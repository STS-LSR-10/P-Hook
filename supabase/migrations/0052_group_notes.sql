-- Notes kept in a LINE group. Like a group's files and reminders they belong to the group's owner
-- (user_id), so they count against the owner's note limit, and group_id keeps them apart from the
-- owner's own: a personal list never shows them. created_by is the LINE id of the member who wrote
-- one, who may change or remove it (and so may the owner). Additive and idempotent.
alter table notes add column if not exists group_id uuid references bot_groups(id) on delete cascade;
alter table notes add column if not exists created_by text;
create index if not exists notes_group_idx
  on notes (group_id, created_at desc) where group_id is not null;
