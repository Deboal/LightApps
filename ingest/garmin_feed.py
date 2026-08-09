"""Garmin feed — unofficial, and treated as such.

There is no personal Garmin API. The Connect Developer Program requires a legal
entity and rejects personal-use applications; the Health API is partner-only,
OAuth 1.0a, push-only. So this goes through python-garminconnect, which logs in
the way a browser does and reads Connect's internal endpoints.

That route is genuinely fragile. Garmin changed its auth flow in March 2026,
which killed `garth` outright (deprecated, final release 2026-03-28).
python-garminconnect survived by rebuilding login on curl_cffi to impersonate the
Android app at the TLS layer. It can break again with no notice.

Two consequences that shape this file:

1. MFA cannot be answered in CI. Nobody is there to type a code. So login happens
   ONCE locally via authorize_garmin.py, and the resulting token store is carried
   forward — seeded from a GitHub secret, then self-maintained in Supabase as the
   library refreshes it. `prompt_mfa` here raises rather than blocking forever on
   stdin, which is the difference between a failed job and a hung one.

2. Every extraction is defensive and every failure is per-metric. A response
   shape change should cost one field, not the run. The caller treats a total
   Garmin failure as a warning, never as a job failure.
"""

from __future__ import annotations

import io
import json
import os
import shutil
import tarfile
import tempfile
from pathlib import Path

from common import clean, log

M_TO_FT = 3.28084


def _no_mfa():
    raise RuntimeError(
        "Garmin is asking for an MFA code, which cannot be answered in CI. "
        "Re-run authorize_garmin.py locally to mint a fresh token store, then "
        "update the GARMIN_TOKENS_B64 secret."
    )


def _dig(obj, *path, default=None):
    """Walk a nested dict/list path, returning default on any miss."""
    cur = obj
    for key in path:
        if cur is None:
            return default
        if isinstance(key, int):
            if not isinstance(cur, (list, tuple)) or len(cur) <= key:
                return default
            cur = cur[key]
        else:
            if not isinstance(cur, dict):
                return default
            cur = cur.get(key)
    return default if cur is None else cur


def tokens_to_b64(token_dir: Path) -> str:
    """Pack a token store directory into a base64 tar for storage."""
    import base64
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(token_dir, arcname=".")
    return base64.b64encode(buf.getvalue()).decode()


def b64_to_tokens(blob: str, dest: Path) -> None:
    import base64
    dest.mkdir(parents=True, exist_ok=True)
    raw = base64.b64decode("".join(blob.split()))
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tar:
        # Refuse absolute or parent-escaping paths from the archive.
        for m in tar.getmembers():
            p = Path(m.name)
            if p.is_absolute() or ".." in p.parts:
                raise RuntimeError(f"unsafe path in token archive: {m.name}")
        tar.extractall(dest)


def fetch(token_blob: str, dates: list[str], on_new_tokens) -> dict[str, dict]:
    """Return {date: {metric: value}}. Raises only on login failure."""
    try:
        from garminconnect import Garmin
    except ImportError as e:
        raise RuntimeError(f"garminconnect not installed: {e}")

    workdir = Path(tempfile.mkdtemp(prefix="garmin-tokens-"))
    try:
        b64_to_tokens(token_blob, workdir)
        api = Garmin(prompt_mfa=_no_mfa)
        api.login(str(workdir))
        log("garmin: session restored from token store")

        # The library refreshes tokens in place. Persist if they changed so the
        # store does not silently expire back to whatever the secret holds.
        try:
            after = tokens_to_b64(workdir)
            if after != token_blob:
                on_new_tokens(after)
                log("garmin: token store refreshed and persisted")
        except Exception as e:  # persistence is best-effort, never fatal
            log(f"garmin: could not persist refreshed tokens ({e})")

        days: dict[str, dict] = {}

        for d in dates:
            row: dict = {}

            # -- resting heart rate --
            try:
                rhr = api.get_rhr_day(d)
                val = _dig(rhr, "allMetrics", "metricsMap",
                           "WELLNESS_RESTING_HEART_RATE", 0, "value")
                if val is None:
                    val = _dig(rhr, "restingHeartRate")
                row["rhr"] = int(val) if val else None
            except Exception as e:
                log(f"garmin {d}: rhr failed ({type(e).__name__}: {e})")

            # -- HRV (last night's average) --
            try:
                hrv = api.get_hrv_data(d)
                val = _dig(hrv, "hrvSummary", "lastNightAvg")
                row["hrv"] = float(val) if val else None
            except Exception as e:
                log(f"garmin {d}: hrv failed ({type(e).__name__}: {e})")

            # -- sleep --
            try:
                sl = api.get_sleep_data(d)
                secs = _dig(sl, "dailySleepDTO", "sleepTimeSeconds")
                row["sleepHrs"] = round(float(secs) / 3600, 2) if secs else None
            except Exception as e:
                log(f"garmin {d}: sleep failed ({type(e).__name__}: {e})")

            # -- training done that day: moving time and vert --
            try:
                acts = api.get_activities_by_date(d, d) or []
                if acts:
                    secs = sum(float(a.get("duration") or 0) for a in acts)
                    gain_m = sum(float(a.get("elevationGain") or 0) for a in acts)
                    row["actualHrs"] = round(secs / 3600, 2) if secs else None
                    row["actualVert"] = round(gain_m * M_TO_FT) if gain_m else None
                    row["activities"] = len(acts)
            except Exception as e:
                log(f"garmin {d}: activities failed ({type(e).__name__}: {e})")

            row = clean(row)
            if row:
                days[d] = row

        got = sum(1 for v in days.values() if "rhr" in v or "hrv" in v)
        log(f"garmin: {len(days)} day(s) with data, {got} with readiness metrics")
        if dates and not days:
            log("garmin: WARNING logged in but extracted nothing — response shapes "
                "may have changed. Check the per-metric errors above.")
        return days
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
