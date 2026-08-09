"""Shared plumbing for the wearable ingestion job.

Runs in GitHub Actions, not in the browser. Writes into the same `app_data` table
the cocodona-coach app reads, using the service_role key.

Two things here are load-bearing and easy to get wrong:

1. `owner` must be set explicitly on every row. The table defaults it to
   `auth.uid()`, which is NULL for the service_role key, and the app reads under
   an RLS policy of `owner = auth.uid()`. A row written without an owner is
   invisible to the app — it silently vanishes rather than erroring.

2. Both providers rotate their credentials. WHOOP hands back a new refresh token
   on every exchange; Garmin's token store gets refreshed in place. A GitHub
   Actions secret cannot rewrite itself, so the job seeds from the secret on
   first run and then keeps the live credential in `integration_secrets`.
"""

from __future__ import annotations

import base64
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone

import requests

APP = "cocodona-coach"
TIMEOUT = 30


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def env(name: str, required: bool = True, default: str | None = None) -> str | None:
    v = os.environ.get(name) or default
    if required and not v:
        log(f"FATAL: missing required environment variable {name}")
        sys.exit(2)
    return v


class Supabase:
    """Thin REST client. Avoids pulling supabase-py in for four calls."""

    def __init__(self, url: str, service_key: str):
        self.url = url.rstrip("/")
        self.key = service_key
        self.s = requests.Session()
        self.s.headers.update({
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        })

    # -- owner resolution ----------------------------------------------------

    def user_id_for_email(self, email: str) -> str:
        """Resolve the auth user id for an email via the admin API.

        Asking for an email rather than a UUID means one less opaque string to
        copy into secrets, and a typo produces a clear error instead of rows that
        write successfully and are never visible.
        """
        page = 1
        want = email.strip().lower()
        while page <= 20:
            r = self.s.get(f"{self.url}/auth/v1/admin/users",
                           params={"page": page, "per_page": 200}, timeout=TIMEOUT)
            r.raise_for_status()
            body = r.json()
            users = body.get("users", body if isinstance(body, list) else [])
            if not users:
                break
            for u in users:
                if (u.get("email") or "").lower() == want:
                    return u["id"]
            page += 1
        raise SystemExit(
            f"FATAL: no Supabase auth user with email {email}. Sign in to the coach "
            f"app once first so the account exists."
        )

    # -- app data ------------------------------------------------------------

    def upsert_doc(self, owner: str, collection: str, doc_id: str, data: dict) -> None:
        payload = {
            "app": APP,
            "collection": collection,
            "doc_id": doc_id,
            "data": data,
            "owner": owner,          # see module docstring: not optional
            "visibility": "private",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        r = self.s.post(
            f"{self.url}/rest/v1/app_data",
            params={"on_conflict": "app,collection,doc_id"},
            headers={"Prefer": "resolution=merge-duplicates"},
            data=json.dumps(payload), timeout=TIMEOUT,
        )
        if r.status_code >= 300:
            raise RuntimeError(f"upsert {collection}/{doc_id} failed {r.status_code}: {r.text[:300]}")

    # -- rotating credentials ------------------------------------------------

    def get_secret(self, owner: str, provider: str) -> dict | None:
        r = self.s.get(f"{self.url}/rest/v1/integration_secrets",
                       params={"owner": f"eq.{owner}", "provider": f"eq.{provider}",
                               "select": "secret"}, timeout=TIMEOUT)
        if r.status_code == 404 or r.status_code == 406:
            return None
        r.raise_for_status()
        rows = r.json()
        return rows[0]["secret"] if rows else None

    def put_secret(self, owner: str, provider: str, secret: dict) -> None:
        payload = {"owner": owner, "provider": provider, "secret": secret,
                   "updated_at": datetime.now(timezone.utc).isoformat()}
        r = self.s.post(f"{self.url}/rest/v1/integration_secrets",
                        params={"on_conflict": "owner,provider"},
                        headers={"Prefer": "resolution=merge-duplicates"},
                        data=json.dumps(payload), timeout=TIMEOUT)
        if r.status_code >= 300:
            raise RuntimeError(f"put_secret {provider} failed {r.status_code}: {r.text[:300]}")


def days_back(n: int) -> list[str]:
    """ISO dates for the last n days, oldest first, including today.

    A window rather than just yesterday: WHOOP recalculates recovery when a nap
    lands late, and Garmin backfills when a watch syncs days after the fact. Both
    would leave permanent holes on a strictly-yesterday fetch.
    """
    today = date.today()
    return [(today - timedelta(days=i)).isoformat() for i in range(n - 1, -1, -1)]


def b64_json(raw: str) -> dict:
    """Decode a base64 GitHub secret into JSON, tolerating whitespace/newlines."""
    return json.loads(base64.b64decode("".join(raw.split())).decode())


def clean(d: dict) -> dict:
    """Drop None values so a missing metric never overwrites a present one."""
    return {k: v for k, v in d.items() if v is not None}
