-- A monthly budget cycle may start on any day 1-31; a month without that day starts on its last
-- day (worked out in the app). Additive and idempotent.
alter table user_settings drop constraint if exists user_settings_cycle_start_day_check;
alter table user_settings add constraint user_settings_cycle_start_day_check
  check (cycle_start_day between 1 and 31);
