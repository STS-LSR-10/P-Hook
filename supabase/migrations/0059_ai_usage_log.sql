-- One row per call to an AI provider, with the tokens it used, so the admin page can show what the AI
-- really costs. Holds no user id and no text: only the provider, model, feature and token counts.
-- Additive and idempotent. Server only (RLS on, no policies).
create table if not exists ai_usage_log (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  provider      text not null check (char_length(provider) between 1 and 20),
  model         text not null check (char_length(model) between 1 and 100),
  feature       text not null check (char_length(feature) between 1 and 40),
  input_tokens  integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0)
);
create index if not exists ai_usage_log_created_idx on ai_usage_log (created_at);
alter table ai_usage_log enable row level security;

-- Calls and tokens between two moments, per provider, model and feature (summed here because a plain
-- select stops at the API's row limit).
create or replace function ai_usage_summary(p_from timestamptz, p_to timestamptz)
returns table (
  provider text,
  model text,
  feature text,
  calls bigint,
  input_tokens bigint,
  output_tokens bigint,
  first_at timestamptz
)
language sql stable security invoker as $$
  select l.provider, l.model, l.feature, count(*)::bigint,
         coalesce(sum(l.input_tokens), 0)::bigint, coalesce(sum(l.output_tokens), 0)::bigint,
         min(l.created_at)
    from ai_usage_log l
   where l.created_at >= p_from and l.created_at < p_to
   group by l.provider, l.model, l.feature;
$$;

revoke execute on function ai_usage_summary(timestamptz, timestamptz) from public, anon, authenticated;
