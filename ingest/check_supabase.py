"""Supabase setup diagnostic, run from GitHub Actions.

Exists because the dev environment's network policy blocks supabase.co outright,
so the only way to actually look at the project is from a runner that can reach it.

Runs in two tiers so it is useful before any secrets are configured:

  Tier 0 (no secrets)   reachability, whether app_data exists, whether anon access
                        is still open, whether integration_secrets is properly
                        locked. Uses the publishable key already committed in
                        shared/config.js.
  Tier 1 (service_role) auth user lookup, row counts, ownerless rows, which
                        integration credentials are stored, storage bucket.

NEVER prints a key, a token, or a secret value. Only presence, length and shape.
Exit is always 0 unless the project is unreachable — this is a report, not a gate.
"""

from __future__ import annotations

import json
import os
import re
import pathlib
import sys

import requests

TIMEOUT = 25
APP = "cocodona-coach"

OK, WARN, BAD, INFO = "  ok  ", " warn ", " FAIL ", " ..   "


def line(mark: str, label: str, detail: str = "") -> None:
    print(f"[{mark}] {label}" + (f"  —  {detail}" if detail else ""), flush=True)


def section(title: str) -> None:
    print(f"\n=== {title} ===", flush=True)


def publishable_key_from_repo() -> tuple[str | None, str | None]:
    """Read the public URL + key out of shared/config.js.

    These are committed on purpose; the real boundary is row-level security.
    Reading them here means tier 0 needs no secrets at all.
    """
    p = pathlib.Path(__file__).resolve().parent.parent / "shared" / "config.js"
    if not p.exists():
        return None, None
    txt = p.read_text()
    url = re.search(r'SUPABASE_URL\s*=\s*"([^"]+)"', txt)
    key = re.search(r'SUPABASE_KEY\s*=\s*"([^"]+)"', txt)
    return (url.group(1) if url else None), (key.group(1) if key else None)


def main() -> int:
    repo_url, pub_key = publishable_key_from_repo()
    url = (os.environ.get("SUPABASE_URL") or repo_url or "").rstrip("/")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    coach_email = os.environ.get("COACH_USER_EMAIL")

    section("configuration")
    line(OK if url else BAD, "project URL", url or "not found")
    line(OK if pub_key else WARN, "publishable key from shared/config.js",
         f"{len(pub_key)} chars" if pub_key else "missing")
    line(OK if service_key else WARN, "SUPABASE_SERVICE_ROLE_KEY secret",
         f"set, {len(service_key)} chars" if service_key else "NOT SET — tier 1 checks will be skipped")
    line(OK if coach_email else WARN, "COACH_USER_EMAIL secret",
         "set" if coach_email else "NOT SET — cannot resolve the owner UUID")
    if not url:
        line(BAD, "cannot continue without a project URL")
        return 1

    # Guard against the classic mixup: the service_role key is a different JWT
    # from the publishable key, and pasting the wrong one produces confusing
    # permission errors much later.
    if service_key and pub_key and service_key.strip() == pub_key.strip():
        line(BAD, "SUPABASE_SERVICE_ROLE_KEY equals the publishable key",
             "paste the service_role key from Project Settings → API")
        service_key = None

    # ---------------------------------------------------------------- tier 0 --
    section("tier 0 — reachability and public surface")
    try:
        r = requests.get(f"{url}/auth/v1/health", headers={"apikey": pub_key or ""}, timeout=TIMEOUT)
        line(OK if r.ok else BAD, "auth health", f"HTTP {r.status_code}")
    except Exception as e:
        line(BAD, "project unreachable", f"{type(e).__name__}: {e}")
        return 1

    anon = {"apikey": pub_key or "", "Authorization": f"Bearer {pub_key or ''}"}

    # Probing anon access by status code alone is WRONG and gave a false negative
    # the first time this ran. Dropping an RLS policy does not make PostgREST
    # reject the request — RLS filters rows, so a locked-down table answers
    # 200 with an empty array. (integration_secrets answers 401 only because it
    # additionally revokes the table grant, which is a different mechanism.)
    #
    # The real test is comparative: if service_role can see rows and anon sees
    # none, RLS is doing its job. That verdict is resolved in tier 1; tier 0 can
    # only report what anon got.
    anon_rows = None
    r = requests.get(f"{url}/rest/v1/app_data", params={"select": "app", "limit": 5},
                     headers=anon, timeout=TIMEOUT)
    if r.status_code == 200:
        try:
            anon_rows = len(r.json())
        except Exception:
            anon_rows = None
        if anon_rows:
            line(BAD, "app_data READABLE by anon", f"returned {anon_rows} row(s) with the publishable "
                                                   f"key — schema-auth-enforce.sql has not taken effect")
        else:
            line(OK, "app_data returns nothing to anon",
                 "HTTP 200 with 0 rows — RLS is filtering (confirmed against service_role in tier 1)")
    elif r.status_code in (401, 403):
        anon_rows = 0
        line(OK, "app_data denied to anon", f"HTTP {r.status_code} — blocked at the grant level")
    elif r.status_code == 404:
        line(BAD, "app_data does not exist", "run schema.sql")
    else:
        line(WARN, "app_data anon probe", f"HTTP {r.status_code}: {r.text[:160]}")

    # owner/visibility columns => schema-auth.sql applied.
    r = requests.get(f"{url}/rest/v1/app_data", params={"select": "owner,visibility", "limit": 1},
                     headers=anon, timeout=TIMEOUT)
    if r.status_code in (200, 401, 403):
        line(OK, "app_data has owner + visibility columns", "schema-auth.sql applied")
    elif "column" in r.text.lower():
        line(BAD, "app_data missing owner/visibility", "run schema-auth.sql — the ingestion job needs them")
    else:
        line(WARN, "column probe inconclusive", f"HTTP {r.status_code}: {r.text[:160]}")

    r = requests.get(f"{url}/rest/v1/integration_secrets", params={"select": "provider", "limit": 1},
                     headers=anon, timeout=TIMEOUT)
    if r.status_code == 404:
        line(WARN, "integration_secrets does not exist", "run schema-integrations.sql before the first ingest")
    elif r.status_code == 200:
        line(BAD, "integration_secrets READABLE BY ANON", "it must have RLS on and zero policies — "
                                                          "re-run schema-integrations.sql")
    elif r.status_code in (401, 403):
        line(OK, "integration_secrets exists and denies anon", f"HTTP {r.status_code}")
    else:
        line(WARN, "integration_secrets probe", f"HTTP {r.status_code}: {r.text[:160]}")

    # ---------------------------------------------------------------- tier 1 --
    if not service_key:
        section("tier 1 — skipped")
        line(INFO, "add SUPABASE_SERVICE_ROLE_KEY to run the deeper checks")
        print("\ndone (tier 0 only)")
        return 0

    section("tier 1 — privileged checks")
    svc = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}

    r = requests.get(f"{url}/rest/v1/app_data", params={"select": "app", "limit": 1},
                     headers=svc, timeout=TIMEOUT)
    if not r.ok:
        line(BAD, "service_role cannot read app_data", f"HTTP {r.status_code}: {r.text[:200]}")
        return 0
    line(OK, "service_role can read app_data")

    # Resolve the anon verdict properly, now that we can see ground truth.
    rc = requests.get(f"{url}/rest/v1/app_data", params={"select": "app"},
                      headers={**svc, "Prefer": "count=exact", "Range": "0-0"}, timeout=TIMEOUT)
    total = None
    cr = rc.headers.get("content-range", "")
    if "/" in cr:
        tail = cr.split("/")[-1]
        total = int(tail) if tail.isdigit() else None
    if total is None:
        line(WARN, "could not count app_data rows", f"content-range: {cr!r}")
    elif anon_rows is None:
        line(WARN, "anon verdict inconclusive", "the anon probe did not return a usable body")
    elif total == 0:
        line(INFO, "app_data is empty", "cannot confirm RLS either way with no rows to filter")
    elif anon_rows == 0:
        line(OK, "SIGN-IN IS ENFORCED",
             f"service_role sees {total} row(s), anon sees 0 — schema-auth-enforce.sql is in effect")
    else:
        line(BAD, "SIGN-IN IS NOT ENFORCED",
             f"anon read {anon_rows} of {total} row(s) with the publishable key — run schema-auth-enforce.sql")

    owner_uuid = None
    if coach_email:
        found = None
        for page in range(1, 11):
            ru = requests.get(f"{url}/auth/v1/admin/users",
                              params={"page": page, "per_page": 200}, headers=svc, timeout=TIMEOUT)
            if not ru.ok:
                line(BAD, "admin user listing failed", f"HTTP {ru.status_code}: {ru.text[:160]}")
                break
            body = ru.json()
            users = body.get("users", body if isinstance(body, list) else [])
            if not users:
                break
            for u in users:
                if (u.get("email") or "").lower() == coach_email.strip().lower():
                    found = u
                    break
            if found:
                break
        if found:
            owner_uuid = found["id"]
            line(OK, "coach auth user exists", f"{found.get('email')} → {owner_uuid}")
            line(OK if found.get("last_sign_in_at") else WARN, "last sign-in",
                 found.get("last_sign_in_at") or "never signed in")
        else:
            line(BAD, "no auth user for COACH_USER_EMAIL",
                 "sign in to /cocodona-coach/ once — the ingest job resolves owner from this")

    # What is stored, by collection.
    r = requests.get(f"{url}/rest/v1/app_data",
                     params={"select": "app,collection,doc_id,owner", "app": f"eq.{APP}", "limit": 5000},
                     headers=svc, timeout=TIMEOUT)
    if r.ok:
        rows = r.json()
        by: dict[str, int] = {}
        ownerless: dict[str, int] = {}
        for row in rows:
            c = row.get("collection", "?")
            by[c] = by.get(c, 0) + 1
            if row.get("owner") is None:
                ownerless[c] = ownerless.get(c, 0) + 1
        if by:
            for c, n in sorted(by.items()):
                line(INFO, f"{APP}/{c}", f"{n} row(s)")
        else:
            line(INFO, f"{APP}", "no rows yet")

        # The invisible-row trap. owner defaults to auth.uid(), NULL under
        # service_role, and the app reads owner = auth.uid(). Such rows save
        # successfully and are invisible forever, with no error anywhere.
        if ownerless:
            for c, n in sorted(ownerless.items()):
                line(BAD, f"OWNERLESS rows in {APP}/{c}", f"{n} row(s) — invisible to the app")
        else:
            line(OK, "no ownerless rows", "every row is attributable to a user")
    else:
        line(WARN, "row inventory failed", f"HTTP {r.status_code}: {r.text[:160]}")

    r = requests.get(f"{url}/rest/v1/integration_secrets", params={"select": "provider,updated_at"},
                     headers=svc, timeout=TIMEOUT)
    if r.status_code == 404:
        line(WARN, "integration_secrets missing", "run schema-integrations.sql")
    elif r.ok:
        rows = r.json()
        if rows:
            for row in rows:
                line(OK, f"stored credential: {row.get('provider')}", f"updated {row.get('updated_at')}")
        else:
            line(INFO, "no stored credentials yet", "expected until the first successful ingest run")
    else:
        line(WARN, "integration_secrets read failed", f"HTTP {r.status_code}: {r.text[:160]}")

    r = requests.get(f"{url}/storage/v1/bucket", headers=svc, timeout=TIMEOUT)
    if r.ok:
        names = [b.get("id") for b in r.json()]
        line(OK if "hub-files" in names else WARN, "storage bucket hub-files",
             "present" if "hub-files" in names else f"missing (buckets: {names})")

    # ------------------------------------------------------------- readiness --
    section("ingest readiness")
    have = {
        "SUPABASE_URL": bool(url),
        "SUPABASE_SERVICE_ROLE_KEY": bool(service_key),
        "COACH_USER_EMAIL": bool(coach_email),
        "WHOOP_CLIENT_ID": bool(os.environ.get("WHOOP_CLIENT_ID")),
        "WHOOP_CLIENT_SECRET": bool(os.environ.get("WHOOP_CLIENT_SECRET")),
        "WHOOP_REFRESH_TOKEN": bool(os.environ.get("WHOOP_REFRESH_TOKEN")),
        "GARMIN_TOKENS_B64": bool(os.environ.get("GARMIN_TOKENS_B64")),
    }
    for k, v in have.items():
        line(OK if v else WARN, k, "set" if v else "not set")
    whoop_ready = all(have[k] for k in ("WHOOP_CLIENT_ID", "WHOOP_CLIENT_SECRET", "WHOOP_REFRESH_TOKEN"))
    line(OK if whoop_ready else INFO, "WHOOP feed",
         "ready to run" if whoop_ready else "needs authorize_whoop.py + the three WHOOP_* secrets")
    line(OK if have["GARMIN_TOKENS_B64"] else INFO, "Garmin feed",
         "ready to attempt" if have["GARMIN_TOKENS_B64"] else "needs authorize_garmin.py + GARMIN_TOKENS_B64")

    print("\ndone")
    return 0


if __name__ == "__main__":
    sys.exit(main())
