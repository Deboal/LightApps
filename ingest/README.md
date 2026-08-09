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

**Garmin has no personal API** — but there is a way around that which does not
involve scraping anything.

The Connect Developer Program requires a legal entity and rejects personal-use
applications, and the Health API is partner-only. **intervals.icu is an approved
Garmin partner**, with a native Garmin Connect integration and its own documented
API using plain API-key auth. So the chain becomes:

```
Garmin watch → Garmin Connect → intervals.icu (official partner) → this job
```

Every hop is official and supported. No browser impersonation, no MFA to answer
in CI, no TLS fingerprinting, and nothing that breaks when Garmin ships a UI
change. Setup is browser-only: connect Garmin, generate a key, add one secret.
This is the preferred Garmin path — see step 5 below.

`garmin_feed.py` (direct `python-garminconnect` scrape) is kept as a fallback and
is **skipped entirely whenever intervals.icu delivers**. Garmin changed its auth
flow in March 2026 and killed `garth` (deprecated, final release 2026-03-28);
`python-garminconnect` survived by rebuilding login on `curl_cffi`, and it will
break again. A total failure there is a warning, not a job failure — a red X every
time Garmin ships a change just trains you to ignore the signal.

## One-time setup

### 1. Run the SQL

In the Supabase SQL editor, run `schema-integrations.sql`. It creates
`integration_secrets` with RLS on and **no policies**, so anon and authenticated
are denied everything and only the service_role key can read it. WHOOP refresh
tokens have no business being reachable from a frontend bundle, which is why this
is not in `app_data`.

### 2. Merge, deploy, then sign in to the coach app once

Order matters here and it is easy to get stuck. The app only exists on the live
site after the PR merges and Netlify builds, so: **merge → wait for the deploy →
visit `/cocodona-coach/` → complete the magic-link sign-in.** The ingestion job
resolves your `owner` UUID from `auth.users`, so that account has to exist before
the first run, and it cannot exist until you have signed in somewhere real.

Once sign-in is confirmed working on the live site, run `schema-auth-enforce.sql`
too. Until you do, the `anon all app_data` policy from `schema.sql` is still
active, which means anyone holding the publishable key — committed in
`shared/config.js` and present in every deployed bundle — can read every row in
`app_data`. That is fine for a seating chart. It is not fine once the coach app
starts storing resting heart rate and sleep.

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

### 5. Garmin, the easy way: intervals.icu

**No terminal required.** This is the recommended Garmin path.

1. Create a free account at [intervals.icu](https://intervals.icu).
2. **Settings → Integrations → Garmin Connect → Connect.** Authorize, and make
   sure the **Wellness** and **Sleep** scopes are granted — without them you get
   activities but no resting HR, HRV or sleep, which is most of what the
   readiness rules need. If Garmin did not offer them, disconnect and reconnect.
3. Wait for the first sync, then check **Wellness** shows resting HR and HRV.
4. **Settings → Developer Settings → generate an API key.**
5. Add it as the `INTERVALS_API_KEY` repo secret.

That is it. Auth is HTTP basic with the literal username `API_KEY`; athlete id
`0` means "the authenticated athlete", so the key alone is enough. Set
`INTERVALS_ATHLETE_ID` only if you need to target a different athlete.

The diagnostic (`Supabase check`) validates the key live and reports which
athlete it resolved, so a bad key surfaces immediately rather than at 06:10.

### 5b. Garmin, the hard way: direct scrape (optional fallback)

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
| `INTERVALS_API_KEY` | step 5 — the preferred Garmin path |
| `GARMIN_TOKENS_B64` | step 5b, optional fallback only |

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
| intervals.icu HTTP 401/403 | key revoked or mistyped | regenerate under Developer Settings |
| intervals.icu returns activities but no RHR/HRV | Wellness/Sleep scopes not granted | disconnect and reconnect Garmin there |
| Garmin `RuntimeError: asking for an MFA code` | token store expired | re-run `authorize_garmin.py`, or switch to the intervals path |
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
