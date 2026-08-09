# Cocodona 250 — two apps

Race: **Monday May 3, 2027, 5:00 AM.** Black Canyon City to Flagstaff, AZ.
252.9 mi, +38,791 ft, -33,884 ft, 125-hour cutoff. Entry confirmed.
Runner Alex, crew chief Jackie (non-running), two pacers (unnamed).

Two apps, deliberately split by who reads them and what they hold.

| | `cocodona` | `cocodona-coach` |
|---|---|---|
| Audience | crew and pacers | Alex only |
| Auth | none | `AuthGate`, per-user private |
| Network | none at all | Supabase |
| Storage | `localStorage` | `app_data` |
| Offline | `bash make-offline.sh cocodona` | no |

The crew app touches no network on purpose. Pacers open it in Arizona backcountry
on one bar, or from a file saved to the home screen with the radio off. The coach
app holds health metrics, so it is signed in.

## Where the data came from

Everything traces to the August 2026 handoff package assembled from eleven Claude
threads, plus the Box binder it references.

| File | Source |
|---|---|
| `cocodona/src/course.js` | `aid-stations-2026.csv` — official 2026 Aravaipa data, 22 stations |
| `cocodona/src/plan.js` | `03-race-execution-plan.md` — the 24-block schedule, reconstructed from the July 17 2026 thread and existing nowhere else |
| `cocodona-coach/src/plan.js` | `weekly-summary.csv`, from the Weekly Summary tab of `Cocodona_250_Training_Tracker.xlsx` (Box `2267119561488`) |
| `cocodona-coach/src/limits.js` | Section 8 of `Cocodona_250_Training_Plan.docx` (Box `2267111183851`), which is already a rule table |

Box folder `Cocodona 250 Training` = `387532609827`. Training log naming is
`YYYY-MM-DD Mountain.md` in subfolder `388031941776`.

## Transcribed vs modelled

Kept separate on purpose, and labelled in the UI:

- **Transcribed** — station mileages, gain/loss, crew/pacer/drop/sleep flags,
  block boundaries and durations, the 96-hour clock times, pacer assignments,
  the three decision gates, every guardrail threshold the plan states.
- **Modelled** — per-aid-station arrival times *inside* a multi-segment block
  (distributed by an effort score: flat miles + 2.0/1,000 ft up + 0.5/1,000 ft
  down), the whole 110-hour fallback table, the station-node elevation profile,
  and weekday session durations in the coach app.

Two guardrail thresholds are marked `interpreted` because the plan states them
qualitatively: "HRV well down" became 15% below baseline, and "energy crater
lasting several days" became ≤4/10 for 3 days. Both are editable.

The 96-hour scenario reproduces the source document's clock times exactly
(Elden start Thu 10:45 PM, finish Fri 6:00 AM), which is what validates the block
model against the transcription. There is a test for it.

## Standing data warning

**All course data is 2026 official. The 2027 runner manual has not published.**
The three mandatory-solo sections are owl-habitat closures, which are
permit-driven and can move year to year. A closure that shifts moves the entire
pacer hand-off grid. `Walnut Canyon` crew access and drop bag are already flagged
`VERIFY` for 2027; Block 22 is planned as one unbroken 23.1-mile shift because of it.

The Verify tab lists everything that must be re-checked. `course.js` also
cross-foots the segment table against the published totals on every load, so a
fat-fingered digit surfaces before a wrong split reaches a pacer.

## Race clock

All times are computed as arithmetic on elapsed hours from the Monday 5:00 AM gun,
never with `Date`'s local-time getters. Arizona is MST year-round (UTC-7, no DST)
and these files get opened on phones in other timezones. An earlier draft used
`getHours()` and shifted every split by the viewer's offset.

## Wearable ingestion

`ingest/` plus `.github/workflows/ingest-wearables.yml` pull WHOOP and Garmin into
the coach app nightly. See `ingest/README.md` for the one-time setup — it needs
`schema-integrations.sql` run once, a WHOOP developer app, and a local Garmin login
to get past MFA.

The job writes `feed-whoop` and `feed-garmin` collections and never touches your
typed `checkins`. The app merges all three with manual winning, and surfaces any
material disagreement rather than silently discarding the loser: if WHOOP measured
a resting HR of 52 and you typed 44, manual wins the value and the app says so.

WHOOP is an official API. Garmin is not, and will break again — a total Garmin
failure is a warning, never a blocked recommendation.

## Tests

Not wired to CI; run them by hand after touching the data or the engine.
They live outside the repo (no test-only deps in `package.json`) — see the
session scratchpad for `verify.mjs` (course + all three split tables),
`advise-test.mjs` (the recommendation engine, including that hard stops cannot be
outranked by good numbers elsewhere), `merge-test.mjs` (source priority and
conflict detection), and `ingest_test.py` (WHOOP response mapping, HRV unit
coercion, token round-tripping).

There is also a signed-in browser harness: copy `apps/cocodona-coach/src/` to a
temp dir, point the two `shared/` imports at stubs that fake `AuthGate` and
`store`, and bundle from the repo root so `react` resolves. That is the only way to
exercise the Today tab, provenance strip and stale-feed banner without a real
Supabase session.

## Still open

Carried from the handoff and surfaced in the apps rather than buried here:
re-verify against the 2027 manual, name Pacer A and B, build the Logistics
document, sweat sodium test, ankle injury history for the BetterGuard decision,
and reconcile the heat block duration (Workout Reference says 4 weeks, the July
supplement says 10–14 days).

One conflict the coach app surfaces but cannot resolve: the heat notes set
Karvonen zones at resting 45 / max 200, which puts Zone 2 at 138–153, while the
Brokeoff log used an age-predicted max of 184 and called 126 bpm "solid Zone 2".
By Karvonen that same 126 is Zone 1. A tested max would settle it.
