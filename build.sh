#!/usr/bin/env bash
# Build every app under apps/ into public/. Netlify runs this on each push.
set -euo pipefail

[ -d node_modules ] || npm install
ESBUILD=./node_modules/.bin/esbuild

# Which build this is, so a running page can say so.
#
# Every app ships as one bundle behind a service worker that deliberately does
# not take over a live tab, so a browser can be a deploy or two behind and look
# identical. That turns "it still does the thing you fixed" into a question
# nobody can answer from the outside. A commit is short enough to read off a
# screen and exact enough to settle it.
BUILD_ID=$(git rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d-%H%M)
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then BUILD_ID="$BUILD_ID+"; fi

rm -rf public && mkdir -p public
names=()

for dir in apps/*/; do
  name=$(basename "$dir")

  # A "static" app is one with an index.html and no src/app.jsx — a self-contained
  # page that needs no bundling (cocodona-3d is one: Three.js is already inlined).
  # Previously these were skipped outright, so their index.html never reached
  # public/ and the app silently failed to deploy.
  #
  # Every *.html in the app folder is copied, not just index.html, so an app can
  # be several linked pages (azores is one: index + itinerary + terrain). Copying
  # only index.html used to drop the sibling pages and leave dead nav links.
  if [ ! -f "${dir}src/app.jsx" ]; then
    if [ -f "${dir}index.html" ]; then
      echo "copying $name (static, no bundle)"
      mkdir -p "public/$name"
      cp "${dir}"*.html "public/$name/"
      names+=("$name")
    else
      echo "skip $name (no src/app.jsx and no index.html)"
    fi
    continue
  fi

  echo "building $name"
  mkdir -p "public/$name"
  "$ESBUILD" "${dir}src/app.jsx" \
    --bundle --minify --format=iife --platform=browser --target=es2018 \
    --define:process.env.NODE_ENV='"production"' \
    --define:__BUILD_ID__="\"$BUILD_ID\"" \
    --jsx=transform --loader:.js=jsx --outfile="public/$name/bundle.js"
  cp "${dir}"*.html "public/$name/"

  # An app may run part of itself off the main thread. Each src/*.worker.js is
  # bundled separately, because a Worker needs its own entry point — the app
  # loads it by name, e.g. new Worker("worker.js").
  for wsrc in "${dir}"src/*worker.js; do
    [ -f "$wsrc" ] || continue
    wname=$(basename "$wsrc")
    echo "  bundling $name/$wname"
    "$ESBUILD" "$wsrc" \
      --bundle --minify --format=iife --platform=browser --target=es2018 \
      --outfile="public/$name/$wname"
  done

  # Static data the app fetches at runtime (grids, lookup tables, images).
  if [ -d "${dir}assets" ]; then
    echo "  copying $name/assets"
    cp -R "${dir}assets" "public/$name/"
  fi

  # An app may ship a service worker to work offline. It is stamped with a
  # hash of everything it precaches, so a changed build is a changed worker,
  # a new cache and one atomic swap -- rather than a version constant someone
  # has to remember to bump, which is a version constant that goes stale.
  if [ -f "${dir}sw.js" ]; then
    stamp=$(cat "public/$name/bundle.js" "public/$name/assets/"* 2>/dev/null | shasum -a 256 | cut -c1-12)
    echo "  service worker for $name (build $stamp)"
    sed "s/__BUILD__/$stamp/" "${dir}sw.js" > "public/$name/sw.js"
  fi

  # An app may ship a browser extension alongside it; publish it as a download.
  # Guarded so a missing zip binary can never fail the deploy.
  if [ -d "${dir}extension" ]; then
    if command -v zip > /dev/null 2>&1; then
      (cd "$dir" && zip -qr "../../public/$name/$name-extension.zip" extension) \
        && echo "  packaged $name/extension"
    else
      echo "  skip $name extension (no zip binary)"
    fi
  fi

  names+=("$name")
done

# Landing page listing the apps.
{
  echo '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>App Hub</title>'
  echo '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f1318;color:#e7edf2;max-width:680px;margin:0 auto;padding:48px 20px}h1{letter-spacing:-.02em}a{color:#33c2b0;text-decoration:none;font-size:18px}li{margin:10px 0}ul{list-style:none;padding:0}</style>'
  echo '</head><body><h1>App Hub</h1><p style="color:#8b97a3;margin:-6px 0 20px">Lightweight apps, one shared backend.</p><ul>'
  for a in "${names[@]:-}"; do [ -n "$a" ] && echo "<li><a href=\"./$a/\">$a</a></li>"; done
  echo '</ul></body></html>'
} > public/index.html

echo "Built ${#names[@]} app(s): ${names[*]:-none}"
