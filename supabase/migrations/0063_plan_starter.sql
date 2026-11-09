-- A fourth plan tier: Starter, between Free and Pro. The stored ids stay as they were ("plus" is Pro,
-- "ultimate" is Elite), so nobody's plan changes. Additive and idempotent.
alter type plan_tier add value if not exists 'starter' before 'plus';

-- The suggestions table lists the plans it accepts.
alter table feedback drop constraint if exists feedback_plan_check;
alter table feedback add constraint feedback_plan_check
  check (plan in ('free', 'starter', 'plus', 'ultimate'));
