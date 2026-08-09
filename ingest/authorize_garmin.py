"""One-time local Garmin login. Run on your laptop, not in CI.

    python authorize_garmin.py

Prompts for your Garmin Connect credentials and the MFA code, then prints a base64
token store to paste into the GARMIN_TOKENS_B64 GitHub secret.

This exists because MFA cannot be answered by a scheduled job. Log in once
interactively here; the job then carries the resulting session forward and the
library refreshes it in place, persisting back to Supabase. Expect to repeat this
roughly yearly, or whenever Garmin changes their auth flow again — which they did
in March 2026, taking `garth` with it.

Your password is never stored anywhere. Only the resulting session tokens are.
"""

from __future__ import annotations

import getpass
import shutil
import sys
import tempfile
from pathlib import Path

from garmin_feed import tokens_to_b64


def main() -> int:
    try:
        from garminconnect import Garmin
    except ImportError:
        print("FAILED: pip install -r requirements.txt first")
        return 1

    email = input("Garmin Connect email: ").strip()
    password = getpass.getpass("Garmin Connect password (not stored): ")

    workdir = Path(tempfile.mkdtemp(prefix="garmin-auth-"))
    try:
        api = Garmin(email, password, prompt_mfa=lambda: input("MFA code: ").strip())
        api.login()
        # Persist the freshly-minted session into our own directory.
        api.garth.dump(str(workdir))

        # Prove the session actually works before handing over a token blob.
        try:
            name = api.get_full_name()
            print(f"\nLogged in as: {name}")
        except Exception as e:
            print(f"\nWARNING: logged in but a test call failed ({e}). "
                  f"The token store may still be fine.")

        blob = tokens_to_b64(workdir)
        print("\n" + "=" * 68)
        print("Add this as a GitHub Actions secret named GARMIN_TOKENS_B64:")
        print("=" * 68)
        print(blob)
        print("=" * 68)
        print(f"({len(blob)} chars. Paste the whole thing, newlines are tolerated.)")
        return 0
    except Exception as e:
        print(f"\nFAILED: {type(e).__name__}: {e}")
        print("\nIf this is a 429, wait several minutes — Garmin rate-limits login "
              "attempts aggressively. If it is an auth-flow error, check for a newer "
              "python-garminconnect release; this route is unofficial and breaks.")
        return 1
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
