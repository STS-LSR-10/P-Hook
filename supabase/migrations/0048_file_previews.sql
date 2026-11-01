-- A small preview of a kept picture or video, taken from LINE when the file is kept and stored beside it
-- in R2 as <r2_key>.thumb. It lets the vault show pictures without loading the full files, and is not
-- counted against the person's space. Files kept before this have none. Additive and idempotent.
alter table stored_files add column if not exists has_thumb boolean not null default false;
