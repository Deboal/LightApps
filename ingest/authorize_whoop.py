"""One-time local WHOOP authorization. Run on your laptop, not in CI.

    python authorize_whoop.py --client-id XXX --client-secret YYY

Opens a browser, catches the redirect on localhost, exchanges the code, and prints
the refresh token to paste into the WHOOP_REFRESH_TOKEN GitHub secret. After the
first scheduled run the job stores the rotated token in Supabase and the secret
stops being used, so it only has to be right once.

Register the app at developer.whoop.com first and add this exact redirect URI:

    http://localhost:8723/callback

Note the `offline` scope. Without it WHOOP returns no refresh token at all and
nothing can run unattended.
"""

from __future__ import annotations

import argparse
import http.server
import secrets
import sys
import threading
import urllib.parse
import webbrowser

import requests

from whoop_feed import AUTH_URL, SCOPES, TOKEN_URL

PORT = 8723
REDIRECT = f"http://localhost:{PORT}/callback"
_result: dict = {}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if "code" in q:
            _result["code"] = q["code"][0]
            _result["state"] = (q.get("state") or [""])[0]
            body = b"<h2>Authorized.</h2><p>You can close this tab and return to the terminal.</p>"
        else:
            _result["error"] = q.get("error", ["unknown"])[0]
            body = f"<h2>Failed</h2><pre>{_result['error']}</pre>".encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass  # keep the terminal readable


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client-id", required=True)
    ap.add_argument("--client-secret", required=True)
    args = ap.parse_args()

    state = secrets.token_urlsafe(16)
    url = f"{AUTH_URL}?" + urllib.parse.urlencode({
        "response_type": "code",
        "client_id": args.client_id,
        "redirect_uri": REDIRECT,
        "scope": SCOPES,
        "state": state,
    })

    srv = http.server.HTTPServer(("localhost", PORT), Handler)
    threading.Thread(target=srv.handle_request, daemon=True).start()

    print(f"\nOpening WHOOP authorization. If nothing opens, paste this:\n\n{url}\n")
    webbrowser.open(url)
    print(f"Waiting for the redirect on {REDIRECT} ...")

    for _ in range(600):  # ~2.5 min
        if _result:
            break
        threading.Event().wait(0.25)
    srv.server_close()

    if "code" not in _result:
        print(f"\nFAILED: {_result.get('error', 'timed out waiting for the redirect')}")
        return 1
    if _result.get("state") != state:
        # A mismatched state means the response did not come from the request we made.
        print("\nFAILED: state mismatch, discarding the code.")
        return 1

    r = requests.post(TOKEN_URL, data={
        "grant_type": "authorization_code",
        "code": _result["code"],
        "client_id": args.client_id,
        "client_secret": args.client_secret,
        "redirect_uri": REDIRECT,
    }, timeout=30)
    if r.status_code >= 300:
        print(f"\nFAILED token exchange {r.status_code}: {r.text[:400]}")
        return 1

    tok = r.json()
    rt = tok.get("refresh_token")
    if not rt:
        print("\nFAILED: no refresh_token returned. Confirm the `offline` scope is "
              "enabled on the app in the WHOOP developer dashboard.")
        print(f"Response keys: {sorted(tok)}")
        return 1

    print("\n" + "=" * 68)
    print("Add these as GitHub Actions secrets on this repo:")
    print("=" * 68)
    print(f"WHOOP_CLIENT_ID       {args.client_id}")
    print(f"WHOOP_CLIENT_SECRET   {args.client_secret}")
    print(f"WHOOP_REFRESH_TOKEN   {rt}")
    print("=" * 68)
    print("Scopes granted:", tok.get("scope", "?"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
