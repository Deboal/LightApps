#!/usr/bin/env bash
# Build a single self-contained .html for one app, with the bundle inlined.
#
#   bash make-offline.sh cocodona            -> offline/cocodona.html
#
# For apps with no backend. The result runs from a file:// URL with the radio off,
# which is the point: crew and pacers save it to a phone and "Add to Home Screen"
# before driving into country with no signal.
#
# Refuses to package an app that talks to the network, because a file:// page that
# needs Supabase is a page that shows a spinner forever in the field.
set -euo pipefail

APP="${1:-}"
[ -n "$APP" ] || { echo "usage: bash make-offline.sh <app-name>" >&2; exit 1; }

SRC_DIR="apps/$APP"
[ -f "$SRC_DIR/index.html" ] || { echo "no such app: $APP" >&2; exit 1; }

if grep -rqE 'shared/(client|store|auth)\.js' "$SRC_DIR/src" 2>/dev/null; then
  echo "refusing: $APP imports the shared backend, so it cannot run offline." >&2
  echo "  (offline export is for self-contained apps only)" >&2
  exit 1
fi

# Same reasoning for an app that fetches its own data or spawns a worker: only
# bundle.js gets inlined below, so those requests would fail on a file:// page
# and the export would look fine right up until someone opened it.
if [ -d "$SRC_DIR/assets" ] || ls "$SRC_DIR"/src/*worker.js > /dev/null 2>&1; then
  echo "refusing: $APP loads sidecar files (assets/ or a worker) that this" >&2
  echo "  script does not inline, so the export would break offline." >&2
  exit 1
fi

[ -f "public/$APP/bundle.js" ] || bash build.sh > /dev/null

mkdir -p offline
OUT="offline/$APP.html"

python3 - "$APP" "$OUT" <<'PY'
import sys, pathlib
app, out = sys.argv[1], sys.argv[2]
html = pathlib.Path(f"apps/{app}/index.html").read_text()
bundle = pathlib.Path(f"public/{app}/bundle.js").read_text()

tag = '<script src="bundle.js"></script>'
if tag not in html:
    raise SystemExit(f"{app}/index.html does not contain the expected {tag}")

# A closing </script> inside the bundle would terminate the inline script early.
bundle = bundle.replace("</script>", "<\\/script>")

banner = ("<!-- OFFLINE BUILD. Self-contained: no network requests of any kind.\n"
          "     Save to a phone and Add to Home Screen. -->")
html = html.replace(tag, f"{banner}\n  <script>\n{bundle}\n  </script>")
pathlib.Path(out).write_text(html)
print(f"wrote {out} ({len(html)/1024:.0f} KB)")
PY
