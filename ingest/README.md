# Wearable ingestion

Pulls WHOOP and Garmin into the `cocodona-coach` app's Supabase rows, nightly, via
GitHub Actions. Nothing here ships to the browser.

```
.github/workflows/ingest-wearables.yml   schedule + secrets
ingest/main.py                           orchestration, per-feed isolation
ingest/whoop_feed.py                     official API v2, OAuth 2.0
ingest/garmin_feed.py                    unofficial, best-effort
ingest/common.py                         Supabase REST, rotating-secret store
ingest/authorize_whoop.py                one-time, run locally
ingest/authorize_garmin.py               one-time, run locally
schema-integrations.sql                  the table the rotating credentials live in
```

## What it writes

| Collection | Doc id | Written by |
|---|---|---|
| `checkins` | date | **you, in the app.** The job never touches this. |
| `feed-whoop` | date | the job |
| `feed-garmin` | date | the job |
| `feed-status` | `status` | the job, every run, success or failure |

The app merges all three at read time with **manual winning every field it
supplies**. A scrape fills in what you did not type and can never overwrite what
you did. One deliberate subtlety: a typed `0` counts as a value, so a logged rest
day is not overwritten by a stray watch record.

## The two feeds are not equivalent

**WHOOP has a real official API.** v2, OAuth 2.0, documented. This is the reliable
path and it covers everything the readiness rules need except the subjective
fields.

**Garmin has no personal API.** The Connect Developer Program requires a legal
entity and rejects personal-use applications; the Health API is partner-only,
OAuth 1.0a, push-only. So `garmin_feed.py` uses `python-garminconnect`, which logs
in as a browser does. Garmin changed its auth flow in March 2026 and killed
`garth` (deprecated, final release 2026-03-28); `python-garminconnect` survived by
rebuilding login on `curl_cffi`. **It will break again.** The job therefore treats
a total Garmin failure as a warning, not a job failure — a red X every time Garmin
ships a change just trains you to ignore the signal. The Feeds tab shows real
per-provider state instead.

## One-time setup

### 1. Run the SQL

In the Supabase SQL editor, run `schema-integrations.sql`. It creates
`integration_secrets` with RLS on and **no policies**, so anon and authenticated
are denied everything and only the service_role key can read it. WHOOP refresh
tokens have no business being reachable from a frontend bundle, which is why this
is not in `app_data`.

### 2. Sign in to the coach app once

Visit `/cocodona-coach/` and complete the magic-link sign-in. The job resolves
your `owner` UUID from your email, so the auth user has to exist first.

### 3. Install locally

```bash
cd ingest
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### 4. Authorize WHOOP

Register an app at [developer.whoop.com](https://developer.whoop.com). Add the
redirect URI **exactly**:

```
http://localhost:8723/callback
```

Enable these scopes — `offline` is the one that matters, since without it WHOOP
returns no refresh token and nothing can run unattended:

```
read:recovery  read:sleep  read:cycles  read:workout  read:profile  offline
```

Then:

```bash
python authorize_whoop.py --client-id XXX --client-secret YYY
```

It opens a browser, catches the redirect, and prints the three secrets to add.

### 5. Authorize Garmin

```bash
python authorize_garmin.py
```

Prompts for your Connect email, password, and MFA code, then prints a base64 token
store. **Your password is never stored** — only the resulting session tokens.

This step exists because MFA cannot be answered by a scheduled job. Log in once
here; the job carries the session forward and the library refreshes it in place.
Expect to repeat this roughly yearly, or whenever Garmin changes their auth flow.

If you hit a 429, wait several minutes. Garmin rate-limits login attempts hard.

### 6. Add the repo secrets

Settings → Secrets and variables → Actions:

| Secret | Where it comes from |
|---|---|
| `SUPABASE_URL` | `https://fycvuanvyjujtyjsmyaf.supabase.co` (already in `shared/config.js`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → **service_role**. Not the publishable key. |
| `COACH_USER_EMAIL` | the email you signed into the coach app with |
| `WHOOP_CLIENT_ID` | step 4 |
| `WHOOP_CLIENT_SECRET` | step 4 |
| `WHOOP_REFRESH_TOKEN` | step 4 |
| `GARMIN_TOKENS_B64` | step 5 |

The service_role key bypasses RLS entirely. It belongs only in GitHub Actions
secrets — never in `shared/config.js`, never in a bundle.

### 7. Run it

Actions → **Ingest wearables** → Run workflow. Then open the coach app's **Feeds**
tab, which shows the real last-run state per provider.

## Why credentials get stored in the database

Both rotate. WHOOP hands back a new refresh token on every exchange and
invalidates the old one; Garmin's token store gets refreshed in place. A GitHub
Actions secret cannot rewrite itself without a PAT, so the job **seeds** from the
secret on first run and then self-maintains in `integration_secrets`. After the
first successful run the `WHOOP_REFRESH_TOKEN` secret is no longer read.

The WHOOP rotated token is persisted *before* any data is fetched, so a crash
mid-run cannot leave the stored token behind the server's.

## Schedule

13:10 UTC daily = 06:10 Arizona (MST, UTC-7, no DST). After the night's sleep has
synced and WHOOP has computed recovery, before the 4 AM Pacific training window
would want an answer.

It fetches a **7-day window**, not just yesterday, because WHOOP recalculates
recovery when a late nap lands and Garmin backfills when a watch syncs days later.
A strictly-yesterday fetch leaves permanent holes. Backfill further with
`workflow_dispatch` and the `days` input.

## Failure modes and what they look like

| Symptom | Cause | Fix |
|---|---|---|
| `no Supabase auth user with email …` | step 2 skipped, or a typo in `COACH_USER_EMAIL` | sign in to the app once |
| WHOOP `invalid_grant` | stored refresh token is stale | re-run `authorize_whoop.py`, update the secret |
| WHOOP returns no `refresh_token` | `offline` scope missing on the app | add it in the WHOOP dashboard, re-authorize |
| Garmin `RuntimeError: asking for an MFA code` | token store expired | re-run `authorize_garmin.py` |
| Garmin 429 on authorize | login rate limit | wait several minutes |
| Job green, app shows nothing | rows written without an `owner` | `owner` must be set explicitly; the table's `auth.uid()` default is NULL under service_role |
| `logged in but extracted nothing` | Garmin changed response shapes | check per-metric errors in the log; look for a newer `python-garminconnect` |

That last-but-one is the one to watch. RLS reads `owner = auth.uid()`, so an
ownerless row does not error — it writes successfully and is invisible. `common.py`
sets it on every upsert for exactly this reason.

## Tests

Offline, no network or credentials needed. They live in the session scratchpad
rather than the repo, to keep test-only deps out of `requirements.txt`:
`ingest_test.py` covers HRV unit coercion, day bucketing, defensive extraction,
token round-tripping including a path-traversal refusal, and the WHOOP response
mapping against synthetic payloads. `merge-test.mjs` covers the merge priority and
proves a feed-only day can drive a verdict while the subjective rules stay silent.
