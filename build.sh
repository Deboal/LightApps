#!/usr/bin/env bash
# Build every app under apps/ into public/. Netlify runs this on each push.
set -euo pipefail

[ -d node_modules ] || npm install
ESBUILD=./node_modules/.bin/esbuild

rm -rf public && mkdir -p public
names=()

for dir in apps/*/; do
  name=$(basename "$dir")
  [ -f "${dir}src/app.jsx" ] || { echo "skip $name (no src/app.jsx)"; continue; }
  echo "building $name"
  mkdir -p "public/$name"
  "$ESBUILD" "${dir}src/app.jsx" \
    --bundle --minify --format=iife --platform=browser --target=es2018 \
    --define:process.env.NODE_ENV='"production"' \
    --jsx=transform --outfile="public/$name/bundle.js"
  cp "${dir}index.html" "public/$name/index.html"
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
