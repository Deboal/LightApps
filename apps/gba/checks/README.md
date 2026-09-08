# Browser checks

Things that can only be verified in a real browser: the frame loop, canvas
output, and the lifecycle events that a headless emulator run cannot exercise.

These are deliberately not wired into CI and Playwright is deliberately not in
`package.json` — they need a ROM, which cannot be committed, and a browser.

```sh
bash build.sh
(cd public && python3 -m http.server 8199 &)
GBA_ROM=/path/to/rom.gba node apps/gba/checks/browser-checks.mjs

# GBA_SAV is optional. With one, the checks that need a party in memory --
# the party panel, the AI player, recording a route -- run for real.
GBA_ROM=... GBA_SAV=/path/to/save.sav node apps/gba/checks/browser-checks.mjs
node apps/gba/checks/game-checks.mjs     # no browser, no ROM
node apps/gba/checks/mon-checks.mjs      # no browser, no ROM
node apps/gba/checks/route-checks.mjs    # no browser, no ROM
node apps/gba/checks/policy-checks.mjs   # no browser, no ROM
```

`PLAYWRIGHT` and `CHROMIUM` can override where those are found.
