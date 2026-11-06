-- Five new bot manners (warm, bestie, spicy, tea, night) replace the four old ones, and a name the bot
-- calls the person by. Additive and safe to run again: old values are carried over to the nearest new
-- one (polite and cheer to warm, friendly to bestie, strict to spicy), nothing else is touched.
alter table user_settings drop constraint if exists user_settings_bot_persona_check;
update user_settings set bot_persona = case bot_persona
  when 'polite' then 'warm'
  when 'cheer' then 'warm'
  when 'friendly' then 'bestie'
  when 'strict' then 'spicy'
  else bot_persona end
where bot_persona in ('polite', 'cheer', 'friendly', 'strict');
alter table user_settings alter column bot_persona set default 'warm';
alter table user_settings add constraint user_settings_bot_persona_check
  check (bot_persona in ('warm', 'bestie', 'spicy', 'tea', 'night'));
alter table user_settings add column if not exists call_name text
  check (call_name is null or char_length(call_name) between 1 and 20);
