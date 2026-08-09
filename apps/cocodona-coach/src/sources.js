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
// server and no secret storage, and browser automation needs a browser. The
// ingestion belongs in a scheduled GitHub Action that writes to Supabase; this
// app reads what lands there. Until that exists, `manual` carries the load.

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
    status: "available-not-wired",
    detail:
      "Official API v2 with OAuth 2.0. Recovery, sleep, cycles and workouts, plus webhooks so it can push rather than be polled. Needs a developer app registered at developer.whoop.com and a one-time authorization, then a scheduled job refreshing tokens and writing here.",
    provides: ["rhr", "hrv", "sleepHrs", "recovery", "strain"],
    blockedBy: "No ingestion runner yet. Register the developer app and add the client secret to GitHub Actions.",
  },
  {
    id: "garmin",
    label: "Garmin",
    status: "unofficial-only",
    detail:
      "No personal API exists. Realistic options are python-garminconnect (unofficial, rebuilt on curl_cffi after Garmin's March 2026 auth change, needs your Connect credentials and MFA handling) or headless Playwright. Both can break again without notice.",
    provides: ["rhr", "hrv", "sleepHrs", "actualHrs", "actualVert"],
    blockedBy: "Treat as best-effort enrichment. Never let the recommendation hard-depend on it.",
    warn: true,
  },
];

// Merge readings from several feeds into one day. Earlier sources in `priority`
// win, so a manual entry can always override a scraped value — the human is the
// tiebreaker, not the machine.
export function mergeDay(readings, priority = ["manual", "whoop", "garmin"]) {
  const out = { source: {} };
  for (const f of FIELDS) {
    for (const src of priority) {
      const r = readings[src];
      if (r && typeof r[f.key] === "number" && !Number.isNaN(r[f.key])) {
        out[f.key] = r[f.key];
        out.source[f.key] = src;
        break;
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
  "available-not-wired": "Official API, not wired up",
  "unofficial-only": "No official API",
};
