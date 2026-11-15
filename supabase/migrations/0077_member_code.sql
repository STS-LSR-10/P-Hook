-- A member code for every account, shown on the profile card: PH-XXXX-XXXX, random, from letters and
-- digits without look-alikes (no 0/O, 1/I). It is only a label to quote to support, never a key or a
-- secret. Existing accounts are given one; new accounts get theirs by default. Safe to run again.
create or replace function new_member_code()
returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea;
  chars text;
  code text;
  i int;
begin
  loop
    bytes := gen_random_bytes(8);
    chars := '';
    for i in 0..7 loop
      chars := chars || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
    end loop;
    code := 'PH-' || substr(chars, 1, 4) || '-' || substr(chars, 5, 4);
    exit when not exists (select 1 from users where member_code = code);
  end loop;
  return code;
end $$;

alter table users add column if not exists member_code text;
update users set member_code = new_member_code() where member_code is null;
alter table users alter column member_code set default new_member_code();
alter table users alter column member_code set not null;
create unique index if not exists users_member_code_key on users (member_code);

revoke execute on function new_member_code() from public, anon, authenticated;
