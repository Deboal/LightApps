// sources.js — the wearable data adapter seam.
//
// One interface, three feeds behind it. The engine in advise.js never learns
// where a number came from, which is what lets a broken Garmin scrape degrade
// into "recommendation still works, one field is stale" instead of a blank page.
//
// STATUS AS OF AUGUST 2026 — researched, not assumed:
//
// WHOOP  — has a real, official, documented API. v2, OAuth 2.0, endpoints for
//          recovery, sleep, cycles and workouts, plus webhooks. developer.whoop.com.
//          No browser automation needed. This is the clean path.
//
// GARMIN — has no personal API. The Connect Developer Program requires a legal
//          entity and rejects personal-use applications; the Health API is
//          partner-only, OAuth 1.0a, push-only with no polling endpoint. The
//          community route is unofficial and fragile: Garmin changed its auth
//          flow in March 2026, which killed `garth` (deprecated, final release
//          2026-03-28). `python-garminconnect` survived by rebuilding login on
//          curl_cffi to impersonate the Android app at the TLS layer, working as
//          of v0.3.5 (June 2026), with MFA via callback.
//
// Neither can run inside this app. It is a static bundle on Netlify with no
// server and no secret storage, and browser automation needs a browser. So the
// ingestion lives in .github/workflows/ingest-wearables.yml — a scheduled job
// that writes into the `feed-whoop` and `feed-garmin` collections this app reads.
// See ingest/README.md for the one-time setup. `manual` always carries the
// subjective fields, and carries everything before the job is configured.

export const FIELDS = [
  { key: "rhr",      label: "Resting HR",   unit: "bpm", from: ["whoop", "garmin", "manual"] },
  { key: "hrv",      label: "HRV",          unit: "ms",  from: ["whoop", "garmin", "manual"] },
  { key: "sleepHrs", label: "Sleep",        unit: "hr",  from: ["whoop", "garmin", "manual"] },
  { key: "recovery", label: "Recovery",     unit: "%",   from: ["whoop"] },
  { key: "strain",   label: "Strain",       unit: "",    from: ["whoop"] },
  { key: "energy",   label: "Energy",       unit: "/10", from: ["manual"] },
  { key: "soreness", label: "Soreness",     unit: "/5",  from: ["manual"] },
  { key: "actualHrs",label: "Session time", unit: "hr",  from: ["garmin", "manual"] },
  { key: "actualVert",label: "Vert",        unit: "ft",  from: ["garmin", "manual"] },
];

export const SOURCES = [
  {
    id: "manual",
    label: "Morning check-in",
    status: "live",
    detail:
      "Thirty seconds on waking. Always available, never breaks, and it is the only source for the subjective fields the plan's own autoregulation table depends on — energy, soreness, pain and load. Even with both wearables feeding, these still have to be typed.",
    provides: ["rhr", "hrv", "sleepHrs", "energy", "soreness", "actualHrs", "actualVert"],
  },
  {
    id: "whoop",
    label: "WHOOP",
    status: "wired-pending-setup",
    detail:
      "Official API v2 over OAuth 2.0, pulled nightly by the ingestion job: recovery score, resting HR, HRV and sleep from /v2/recovery and /v2/activity/sleep, day strain from /v2/cycle. Refresh tokens rotate on every use, so the job persists the new one before fetching anything.",
    provides: ["rhr", "hrv", "sleepHrs", "recovery", "strain"],
    blockedBy: "Register an app at developer.whoop.com (with the offline scope), run ingest/authorize_whoop.py once, and add the three WHOOP_* secrets.",
  },
  {
    id: "garmin",
    label: "Garmin",
    status: "unofficial-only",
    detail:
      "No personal API exists, so the job uses python-garminconnect, which logs in as a browser would. Garmin changed its auth flow in March 2026 and broke the whole ecosystem once already. Treated as best-effort enrichment: every metric is extracted defensively and a total failure is a warning, never a blocked recommendation.",
    provides: ["rhr", "hrv", "sleepHrs", "actualHrs", "actualVert"],
    blockedBy: "Run ingest/authorize_garmin.py once locally to answer MFA, then add GARMIN_TOKENS_B64. Expect to redo this roughly yearly.",
    warn: true,
  },
];

// How far two sources may disagree on a metric before it is worth surfacing.
// Absolute units, except `pct` which is a fraction of the winning value.
const TOLERANCE = {
  rhr: { abs: 3 },        // 3 bpm matters: the §8 rule triggers on 5
  hrv: { pct: 0.15 },     // HRV is noisy between devices; 15% is the rule's own threshold
  sleepHrs: { abs: 1.0 },
  actualHrs: { abs: 0.5 },
};

function disagrees(key, winner, other) {
  const tol = TOLERANCE[key];
  if (!tol) return false;
  const diff = Math.abs(winner - other);
  if (tol.abs !== undefined) return diff >= tol.abs;
  return winner > 0 && diff / winner >= tol.pct;
}

// Merge readings from several feeds into one day. Earlier sources in `priority`
// win, so a manual entry can always override a scraped value — the human is the
// tiebreaker, not the machine.
//
// But a silently-discarded disagreement is dangerous here. If WHOOP measured a
// resting HR of 52 and you typed 44, manual wins and the elevated-RHR rule never
// fires — which is the correct precedence and also exactly how a real signal gets
// suppressed without anyone noticing. So every material disagreement is recorded
// in `conflicts` and shown in the UI. Precedence stays; the silence does not.
export function mergeDay(readings, priority = ["manual", "whoop", "garmin"]) {
  const out = { source: {}, conflicts: [] };
  for (const f of FIELDS) {
    let winner = null;
    for (const src of priority) {
      const r = readings[src];
      const v = r ? r[f.key] : undefined;
      if (typeof v !== "number" || Number.isNaN(v)) continue;
      if (winner === null) {
        winner = { src, v };
        out[f.key] = v;
        out.source[f.key] = src;
      } else if (disagrees(f.key, winner.v, v)) {
        out.conflicts.push({
          field: f.key, label: f.label, unit: f.unit,
          kept: winner.v, keptFrom: winner.src, other: v, otherFrom: src,
        });
      }
    }
  }
  for (const src of priority) {
    const r = readings[src];
    if (!r) continue;
    for (const k of ["pain", "illness", "lifeLoad"]) {
      if (r[k] && out[k] === undefined) { out[k] = r[k]; out.source[k] = src; }
    }
  }
  return out;
}

export const STATUS_LABEL = {
  live: "Live",
  "wired-pending-setup": "Wired, needs one-time setup",
  "unofficial-only": "No official API",
};
