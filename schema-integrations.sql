-- INTEGRATION SECRETS (run once, in the Supabase SQL Editor).
--
-- Holds the rotating credentials the wearable ingestion job needs: WHOOP's
-- refresh token (which WHOOP rotates on every use) and Garmin's token store
-- (which python-garminconnect refreshes periodically).
--
-- Why a separate table rather than app_data: app_data is readable by any
-- signed-in user's browser for their own rows, and a WHOOP refresh token has no
-- business being reachable from a frontend bundle. This table grants NOTHING to
-- anon or authenticated. Only the service_role key, which bypasses RLS and lives
-- exclusively in GitHub Actions secrets, can touch it.
--
-- The point of storing them here at all is that both credentials rotate. A
-- GitHub Actions secret cannot rewrite itself without a PAT, so the job seeds
-- from the secret once and then self-maintains here.

create table if not exists public.integration_secrets (
  owner      uuid not null,
  provider   text not null,          -- 'whoop' | 'garmin'
  secret     jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner, provider)
);

-- RLS on with no policies at all: anon and authenticated are denied everything.
-- service_role bypasses RLS entirely, which is the only intended access path.
alter table public.integration_secrets enable row level security;

-- Explicitly revoke, so a future permissive grant elsewhere cannot leak this.
revoke all on public.integration_secrets from anon, authenticated;
