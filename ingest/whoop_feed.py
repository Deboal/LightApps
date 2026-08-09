"""WHOOP feed — the official API, so this one is straightforward.

WHOOP API v2, OAuth 2.0. Base https://api.prod.whoop.com, developer paths under
/developer/v2/. Endpoints used:

    /developer/v2/recovery          recovery score, resting HR, HRV
    /developer/v2/activity/sleep    sleep stage summary
    /developer/v2/cycle             day strain

Scopes needed: read:recovery read:sleep read:cycles read:workout read:profile offline
The `offline` scope is what yields a refresh token. Without it this job cannot run
unattended.

Refresh tokens rotate: every exchange may return a new one, and the old one stops
working. Whatever comes back is persisted before any data fetching happens, so a
crash mid-run cannot leave the stored token behind the server's.
"""

from __future__ import annotations

from collections import defaultdict

import requests

from common import TIMEOUT, clean, log

TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token"
AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth"
API = "https://api.prod.whoop.com/developer/v2"
SCOPES = "read:recovery read:sleep read:cycles read:workout read:profile offline"


def refresh_access_token(client_id: str, client_secret: str, refresh_token: str) -> dict:
    r = requests.post(TOKEN_URL, data={
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": SCOPES,
    }, timeout=TIMEOUT)
    if r.status_code >= 300:
        raise RuntimeError(
            f"WHOOP token refresh failed {r.status_code}: {r.text[:300]}. "
            f"If this is invalid_grant, the stored refresh token is stale — "
            f"re-run authorize_whoop.py to mint a new one."
        )
    return r.json()


def _paged(session: requests.Session, path: str, start: str, end: str, limit: int = 25) -> list[dict]:
    """Walk WHOOP's cursor pagination for a date window."""
    out: list[dict] = []
    token = None
    for _ in range(20):  # hard bound; a window this small never needs 20 pages
        params = {"start": f"{start}T00:00:00.000Z", "end": f"{end}T23:59:59.999Z", "limit": limit}
        if token:
            params["nextToken"] = token
        r = session.get(f"{API}{path}", params=params, timeout=TIMEOUT)
        if r.status_code >= 300:
            raise RuntimeError(f"WHOOP GET {path} failed {r.status_code}: {r.text[:300]}")
        body = r.json()
        out.extend(body.get("records", []) or [])
        token = body.get("next_token") or body.get("nextToken")
        if not token:
            break
    return out


def _hrv_ms(raw):
    """Normalize HRV to milliseconds.

    WHOOP's field is named `hrv_rmssd_milli` but has been observed returning
    values in seconds (0.0665 rather than 66.5). Rather than guess which, coerce
    on magnitude: no human RMSSD is below 1 ms, so a sub-1 value is seconds.
    """
    if raw is None:
        return None
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    if v <= 0:
        return None
    return round(v * 1000, 1) if v < 1 else round(v, 1)


def _day_of(record: dict) -> str | None:
    """Bucket a record onto a calendar day.

    Uses the record's own start timestamp in the local offset WHOOP returns, so a
    sleep beginning 11 PM Tuesday is Tuesday's row rather than Wednesday's.
    """
    ts = record.get("start") or record.get("created_at")
    if not ts or len(ts) < 10:
        return None
    return ts[:10]


def fetch(client_id: str, client_secret: str, refresh_token: str, dates: list[str],
          on_new_refresh_token) -> dict[str, dict]:
    """Return {date: {metric: value}} for the requested window.

    `on_new_refresh_token` is called with the rotated token BEFORE any data is
    fetched, so an exception later cannot orphan the credential.
    """
    tok = refresh_access_token(client_id, client_secret, refresh_token)
    new_rt = tok.get("refresh_token")
    if new_rt and new_rt != refresh_token:
        on_new_refresh_token(new_rt)
        log("whoop: refresh token rotated and persisted")

    access = tok.get("access_token")
    if not access:
        raise RuntimeError(f"WHOOP refresh returned no access_token: {list(tok)}")

    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {access}"})

    start, end = dates[0], dates[-1]
    days: dict[str, dict] = defaultdict(dict)

    # --- recovery: resting HR, HRV, recovery score ---
    recs = _paged(s, "/recovery", start, end)
    log(f"whoop: {len(recs)} recovery record(s)")
    for rec in recs:
        d = _day_of(rec)
        score = rec.get("score") or {}
        if not d or not score:
            continue
        days[d].update(clean({
            "rhr": score.get("resting_heart_rate"),
            "hrv": _hrv_ms(score.get("hrv_rmssd_milli")),
            "recovery": score.get("recovery_score"),
        }))

    # --- sleep: hours actually asleep, not time in bed ---
    sleeps = _paged(s, "/activity/sleep", start, end)
    log(f"whoop: {len(sleeps)} sleep record(s)")
    per_day_sleep: dict[str, float] = defaultdict(float)
    for sl in sleeps:
        d = _day_of(sl)
        score = sl.get("score") or {}
        stages = score.get("stage_summary") or {}
        in_bed = stages.get("total_in_bed_time_milli")
        awake = stages.get("total_awake_time_milli") or 0
        if not d or in_bed is None:
            continue
        if sl.get("nap"):
            # Naps are real sleep but not "last night's sleep", which is what the
            # plan's under-6-hours rule is about. Excluded so a Sunday nap cannot
            # mask a short night.
            continue
        per_day_sleep[d] += max(0.0, (in_bed - awake) / 3_600_000)
    for d, hrs in per_day_sleep.items():
        days[d]["sleepHrs"] = round(hrs, 2)

    # --- cycle: day strain ---
    cycles = _paged(s, "/cycle", start, end)
    log(f"whoop: {len(cycles)} cycle record(s)")
    for cy in cycles:
        d = _day_of(cy)
        score = cy.get("score") or {}
        if not d:
            continue
        strain = score.get("strain")
        if strain is not None:
            days[d]["strain"] = round(float(strain), 1)

    if recs and not any("rhr" in v or "hrv" in v for v in days.values()):
        # Shape drifted. Say so loudly with a sample rather than writing empties.
        log(f"whoop: WARNING extracted nothing from {len(recs)} recovery records. "
            f"Sample keys: {sorted((recs[0].get('score') or {}).keys())}")

    return {d: v for d, v in days.items() if v}
