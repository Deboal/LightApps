"""Garmin data via intervals.icu — the good path.

Garmin has no personal API: the Connect Developer Program requires a legal entity
and rejects personal-use applications, and the Health API is partner-only. Our
options were a scrape (garmin_feed.py, unofficial and already broken once when
Garmin changed auth in March 2026) or nothing.

There is a third option. intervals.icu is an approved Garmin partner with a
native Garmin Connect integration, and it exposes its own documented API with
plain API-key auth. So the chain is:

    Garmin watch → Garmin Connect → intervals.icu (official partner) → this job

Every hop is official and supported. Nobody is impersonating a browser, there is
no MFA to answer in CI, and setup is three clicks plus one API key — no terminal.

Auth is HTTP basic with the literal username "API_KEY" and the key as password.
Athlete id "0" means "the authenticated athlete", so the key alone is enough.

Field names are handled defensively. intervals.icu is a small project that adds
wellness fields as upstream sources expose them, and a rename should cost one
metric rather than the run.
"""

from __future__ import annotations

import requests

from common import TIMEOUT, clean, log

API = "https://intervals.icu/api/v1"
M_TO_FT = 3.28084


def _first(d: dict, *names):
    """First present, non-null value among several possible field spellings."""
    for n in names:
        if isinstance(d, dict) and d.get(n) is not None:
            return d[n]
    return None


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f > 0 else None


def _session(api_key: str) -> requests.Session:
    s = requests.Session()
    s.auth = ("API_KEY", api_key)
    s.headers.update({"Accept": "application/json"})
    return s


def fetch(api_key: str, dates: list[str], athlete_id: str = "0") -> dict[str, dict]:
    """Return {date: {metric: value}} for the requested window."""
    # An empty athlete id builds /api/v1/athlete//wellness, which 404s with a
    # message that looks like a permissions problem and is not one. Refuse to
    # construct that URL at all.
    athlete_id = (athlete_id or "").strip() or "0"
    s = _session(api_key)
    oldest, newest = dates[0], dates[-1]
    days: dict[str, dict] = {}

    # --- wellness: resting HR, HRV, sleep ---
    r = s.get(f"{API}/athlete/{athlete_id}/wellness",
              params={"oldest": oldest, "newest": newest}, timeout=TIMEOUT)
    if r.status_code in (401, 403):
        raise RuntimeError(
            f"intervals.icu rejected the API key (HTTP {r.status_code}). Regenerate it "
            f"under Settings → Developer Settings and update INTERVALS_API_KEY."
        )
    if r.status_code >= 300:
        raise RuntimeError(f"intervals.icu wellness failed {r.status_code}: {r.text[:300]}")

    records = r.json()
    if isinstance(records, dict):
        records = [records]
    log(f"intervals: {len(records)} wellness record(s)")

    for w in records:
        # The wellness record's own id is its date.
        day = str(_first(w, "id", "date") or "")[:10]
        if len(day) != 10:
            continue
        sleep_secs = _num(_first(w, "sleepSecs", "sleep_secs", "sleepTime"))
        row = clean({
            "rhr": _num(_first(w, "restingHR", "restingHr", "resting_hr")),
            "hrv": _num(_first(w, "hrv", "hrvSDNN", "hrv_sdnn")),
            "sleepHrs": round(sleep_secs / 3600, 2) if sleep_secs else None,
        })
        if row:
            days.setdefault(day, {}).update(row)

    if records and not days:
        # Shape drifted. Say so with a sample rather than writing nothing silently.
        log(f"intervals: WARNING extracted nothing from {len(records)} wellness records. "
            f"Sample keys: {sorted(records[0].keys())[:25]}")

    # --- activities: time on feet and vert actually done ---
    try:
        ra = s.get(f"{API}/athlete/{athlete_id}/activities",
                   params={"oldest": oldest, "newest": newest}, timeout=TIMEOUT)
        if ra.ok:
            acts = ra.json()
            if isinstance(acts, dict):
                acts = acts.get("activities", [])
            log(f"intervals: {len(acts)} activity record(s)")
            per_day: dict[str, dict] = {}
            for a in acts:
                day = str(_first(a, "start_date_local", "startDateLocal", "start_date") or "")[:10]
                if len(day) != 10:
                    continue
                secs = _num(_first(a, "moving_time", "movingTime", "elapsed_time", "elapsedTime")) or 0
                gain_m = _num(_first(a, "total_elevation_gain", "totalElevationGain",
                                     "icu_elevation_gain")) or 0
                acc = per_day.setdefault(day, {"secs": 0.0, "gain": 0.0, "n": 0})
                acc["secs"] += secs
                acc["gain"] += gain_m
                acc["n"] += 1
            for day, acc in per_day.items():
                days.setdefault(day, {}).update(clean({
                    "actualHrs": round(acc["secs"] / 3600, 2) if acc["secs"] else None,
                    # intervals.icu reports elevation in metres; the plan is in feet.
                    "actualVert": round(acc["gain"] * M_TO_FT) if acc["gain"] else None,
                    "activities": acc["n"] or None,
                }))
        else:
            log(f"intervals: activities unavailable (HTTP {ra.status_code}) — wellness still used")
    except Exception as e:
        # Activities are enrichment. Losing them must not cost the readiness metrics.
        log(f"intervals: activities failed ({type(e).__name__}: {e}) — wellness still used")

    got = sum(1 for v in days.values() if "rhr" in v or "hrv" in v)
    log(f"intervals: {len(days)} day(s) with data, {got} with readiness metrics")
    return {d: v for d, v in days.items() if v}


def whoami(api_key: str) -> dict:
    """Confirm the key works and report the athlete. Used by the diagnostic."""
    s = _session(api_key)
    r = s.get(f"{API}/athlete/0", timeout=TIMEOUT)
    if r.status_code >= 300:
        raise RuntimeError(f"intervals.icu /athlete/0 failed {r.status_code}: {r.text[:200]}")
    a = r.json()
    return {"id": a.get("id"), "name": a.get("name"), "timezone": a.get("timezone")}
