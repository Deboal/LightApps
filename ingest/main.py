"""Wearable ingestion entry point.

Fetches the last N days from WHOOP and Garmin and writes them into the coach
app's Supabase rows as SEPARATE feed collections:

    feed-whoop / <date>    what WHOOP said
    feed-garmin / <date>   what Garmin said
    feed-status / status   per-provider last success, last error, staleness

Manual check-ins in `checkins` are never touched. The app merges the three at read
time with manual winning, so a scrape can never overwrite something typed by hand.
That priority is deliberate: the human is the tiebreaker, not the machine.

Exit codes:
    0  at least one feed produced data, or both were cleanly empty
    1  every configured feed failed
    2  misconfiguration (missing env)

A Garmin failure alone is a warning, not a job failure. Garmin has no official API
and breaks on their schedule, not ours — a red X every time they ship a change
trains you to ignore the signal.
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from datetime import datetime, timezone

import garmin_feed
import intervals_feed
import whoop_feed
from common import Supabase, days_back, env, log

# `or` rather than a get() default throughout: an unset GitHub Actions secret
# arrives as an EMPTY STRING, not as an absent key, so environ.get(k, "7") returns
# "" and the default never applies. This cost one failed run — the athlete id
# resolved to "" and produced a request to /api/v1/athlete//wellness.
WINDOW_DAYS = int(os.environ.get("INGEST_DAYS") or "7")


def main() -> int:
    # Not-yet-configured is a normal state, not a failure. The nightly cron goes
    # live as soon as this lands on the default branch, which is typically before
    # the secrets exist — and a red X every night until then just teaches you to
    # ignore the job. Skip cleanly instead, and say what is missing.
    missing = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "COACH_USER_EMAIL")
               if not os.environ.get(k)]
    if missing:
        log(f"not configured yet — missing {', '.join(missing)}. Skipping.")
        log("See ingest/README.md for the one-time setup. This is not an error.")
        return 0

    sb_url = env("SUPABASE_URL")
    sb_key = env("SUPABASE_SERVICE_ROLE_KEY")
    owner_email = env("COACH_USER_EMAIL")

    sb = Supabase(sb_url, sb_key)
    owner = sb.user_id_for_email(owner_email)
    log(f"owner resolved: {owner_email} -> {owner}")

    dates = days_back(WINDOW_DAYS)
    log(f"window: {dates[0]} .. {dates[-1]} ({len(dates)} days)")

    status: dict[str, dict] = {}
    wrote_any = False
    configured = 0
    failed = 0

    # ---------------------------------------------------------------- WHOOP --
    wid = (os.environ.get("WHOOP_CLIENT_ID") or "").strip() or None
    wsecret = (os.environ.get("WHOOP_CLIENT_SECRET") or "").strip() or None
    if wid and wsecret:
        configured += 1
        try:
            stored = sb.get_secret(owner, "whoop") or {}
            rt = stored.get("refresh_token") or os.environ.get("WHOOP_REFRESH_TOKEN")
            if not rt:
                raise RuntimeError(
                    "no WHOOP refresh token in integration_secrets or "
                    "WHOOP_REFRESH_TOKEN. Run authorize_whoop.py once."
                )
            if stored.get("refresh_token"):
                log("whoop: using stored refresh token")
            else:
                log("whoop: seeding from WHOOP_REFRESH_TOKEN secret")

            def save_rt(new_rt: str) -> None:
                sb.put_secret(owner, "whoop", {"refresh_token": new_rt})

            data = whoop_feed.fetch(wid, wsecret, rt, dates, save_rt)
            for d, row in sorted(data.items()):
                sb.upsert_doc(owner, "feed-whoop", d, {"date": d, **row})
            log(f"whoop: wrote {len(data)} day(s)")
            wrote_any = wrote_any or bool(data)
            status["whoop"] = {"ok": True, "days": len(data),
                               "lastSuccess": datetime.now(timezone.utc).isoformat()}
        except Exception as e:
            failed += 1
            log(f"whoop: FAILED {type(e).__name__}: {e}")
            traceback.print_exc()
            status["whoop"] = {"ok": False, "error": f"{type(e).__name__}: {e}"[:300],
                               "lastAttempt": datetime.now(timezone.utc).isoformat()}
    else:
        log("whoop: not configured (WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET unset), skipping")
        status["whoop"] = {"configured": False}

    # ------------------------------------------------- Garmin via intervals --
    # Preferred Garmin path: intervals.icu is an approved Garmin partner, so this
    # is Garmin's own data arriving over supported APIs the whole way. Tried
    # before the scrape below, and if it works the scrape is unnecessary.
    intervals_key = (os.environ.get("INTERVALS_API_KEY") or "").strip() or None
    if intervals_key:
        configured += 1
        try:
            who = intervals_feed.whoami(intervals_key)
            log(f"intervals: authenticated as athlete {who.get('id')} ({who.get('name')})")
            # "0" means the authenticated athlete, which is what we want by default.
            athlete = (os.environ.get("INTERVALS_ATHLETE_ID") or "0").strip() or "0"
            data = intervals_feed.fetch(intervals_key, dates, athlete)
            for d, row in sorted(data.items()):
                sb.upsert_doc(owner, "feed-intervals", d, {"date": d, **row})
            log(f"intervals: wrote {len(data)} day(s)")
            wrote_any = wrote_any or bool(data)
            status["intervals"] = {"ok": True, "days": len(data),
                                   "lastSuccess": datetime.now(timezone.utc).isoformat()}
        except Exception as e:
            failed += 1
            log(f"intervals: FAILED {type(e).__name__}: {e}")
            traceback.print_exc()
            status["intervals"] = {"ok": False, "error": f"{type(e).__name__}: {e}"[:300],
                                   "lastAttempt": datetime.now(timezone.utc).isoformat()}
    else:
        log("intervals: not configured (INTERVALS_API_KEY unset), skipping")
        status["intervals"] = {"configured": False}

    # --------------------------------------------- Garmin, direct scrape -----
    # Fallback only. Unofficial, and Garmin has broken it before. Skipped entirely
    # when intervals.icu already delivered, so a scrape that will eventually break
    # is not on the critical path.
    try:
        stored_g = sb.get_secret(owner, "garmin") or {}
    except Exception as e:
        log(f"garmin: could not read stored tokens ({e})")
        stored_g = {}
    blob = stored_g.get("tokens_b64") or (os.environ.get("GARMIN_TOKENS_B64") or "").strip() or None
    if blob and status.get("intervals", {}).get("ok"):
        log("garmin: skipping the direct scrape — intervals.icu already supplied Garmin data")
        status["garmin"] = {"skipped": "intervals.icu succeeded"}
    elif blob:
        configured += 1
        try:
            log("garmin: using stored token store" if stored_g.get("tokens_b64")
                else "garmin: seeding from GARMIN_TOKENS_B64 secret")

            def save_tokens(new_blob: str) -> None:
                sb.put_secret(owner, "garmin", {"tokens_b64": new_blob})

            data = garmin_feed.fetch(blob, dates, save_tokens)
            for d, row in sorted(data.items()):
                sb.upsert_doc(owner, "feed-garmin", d, {"date": d, **row})
            log(f"garmin: wrote {len(data)} day(s)")
            wrote_any = wrote_any or bool(data)
            status["garmin"] = {"ok": True, "days": len(data),
                                "lastSuccess": datetime.now(timezone.utc).isoformat()}
        except Exception as e:
            failed += 1
            log(f"garmin: FAILED {type(e).__name__}: {e}")
            traceback.print_exc()
            status["garmin"] = {"ok": False, "error": f"{type(e).__name__}: {e}"[:300],
                                "lastAttempt": datetime.now(timezone.utc).isoformat(),
                                "unofficial": True}
    else:
        log("garmin: not configured (GARMIN_TOKENS_B64 unset), skipping")
        status["garmin"] = {"configured": False}

    # --------------------------------------------------------------- status --
    # Written even when everything failed: a stale-feed banner in the app is the
    # only way a silent scrape breakage becomes visible.
    try:
        prev = {}
        try:
            r = sb.s.get(f"{sb.url}/rest/v1/app_data",
                         params={"app": "eq.cocodona-coach", "collection": "eq.feed-status",
                                 "doc_id": "eq.status", "owner": f"eq.{owner}",
                                 "select": "data"}, timeout=20)
            if r.ok and r.json():
                prev = r.json()[0].get("data") or {}
        except Exception:
            pass
        # Preserve the previous lastSuccess through a failing run.
        for prov, st in status.items():
            old = (prev.get("providers") or {}).get(prov) or {}
            if not st.get("ok") and old.get("lastSuccess"):
                st["lastSuccess"] = old["lastSuccess"]
        sb.upsert_doc(owner, "feed-status", "status", {
            "providers": status,
            "window": {"from": dates[0], "to": dates[-1]},
            "ranAt": datetime.now(timezone.utc).isoformat(),
        })
        log("wrote feed status")
    except Exception as e:
        log(f"could not write feed status: {e}")

    if configured and failed == configured:
        log("FAILED: every configured feed errored")
        return 1
    log(f"done. {configured - failed}/{configured} feed(s) succeeded"
        + ("" if wrote_any else " (no new data in window)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
