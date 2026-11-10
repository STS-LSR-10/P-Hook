-- The "night owl" manner is gone. Anyone who had chosen it moves to the closest one that is still
-- playful without being sharp (bestie), and the allowed values are now the four that remain.
-- Safe to run again.
alter table user_settings drop constraint if exists user_settings_bot_persona_check;
update user_settings set bot_persona = 'bestie' where bot_persona = 'night';
alter table user_settings add constraint user_settings_bot_persona_check
  check (bot_persona in ('warm', 'bestie', 'spicy', 'tea'));
