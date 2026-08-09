// live.js — where you are against the plan, and when you will reach what's next.
//
// The model is deliberately the simplest defensible one, and it is the one crews
// already use in their heads: measure how far off plan you are right now, then
// carry that same offset forward. It does not try to re-forecast pace from a
// single observation — over 250 miles a two-hour deficit at mile 60 says almost
// nothing about mile 200, and a model that pretends otherwise produces confident
// nonsense at exactly the hour nobody can check it.
//
// The offset projection is stated in the UI so the assumption travels with the
// numbers rather than living in this comment.

import { RACE } from "./course.js";

// Interpolation runs INSIDE a segment, never across the gap between segments.
//
// That gap is where the sleep and hand-off blocks live. Interpolating station to
// station spreads a three-hour sleep at Whiskey Row across the miles after it, so
// a runner reporting mile 78 was measured against a plan time of 22.8 h when the
// plan actually expects them there at 25.0 h — a phantom 2.2-hour deficit, enough
// on its own to trip the 3-hour gate and drop the whole race to the 110-hour
// table. Each split row carries its own moving hours, so the segment's start is
// `elapsed - hrs` and rest time is excluded by construction.
function segmentsOf(splits) {
  return splits.map((s) => ({
    fromMile: +(s.mile - s.segMiles).toFixed(3),
    toMile: s.mile,
    startElapsed: +(s.elapsed - s.hrs).toFixed(3),
    endElapsed: s.elapsed,
  }));
}

/** Plan elapsed hours at an arbitrary mile. Excludes time spent stopped. */
export function planElapsedAtMile(splits, mile) {
  if (mile <= 0) return 0;
  const segs = segmentsOf(splits);
  const last = segs[segs.length - 1];
  if (mile >= last.toMile) return last.endElapsed;
  for (const g of segs) {
    if (mile <= g.toMile) {
      const span = g.toMile - g.fromMile;
      if (span <= 0) return g.endElapsed;
      const frac = Math.max(0, (mile - g.fromMile) / span);
      return g.startElapsed + frac * (g.endElapsed - g.startElapsed);
    }
  }
  return last.endElapsed;
}

/** Mile the plan expects at a given elapsed hour. Stationary during a rest block. */
export function planMileAtElapsed(splits, elapsed) {
  if (elapsed <= 0) return 0;
  const segs = segmentsOf(splits);
  const last = segs[segs.length - 1];
  if (elapsed >= last.endElapsed) return last.toMile;
  for (const g of segs) {
    // Between segments the plan is stopped, so the mile holds at the station.
    if (elapsed < g.startElapsed) return g.fromMile;
    if (elapsed <= g.endElapsed) {
      const span = g.endElapsed - g.startElapsed;
      if (span <= 0) return g.toMile;
      return g.fromMile + ((elapsed - g.startElapsed) / span) * (g.toMile - g.fromMile);
    }
  }
  return last.toMile;
}

/**
 * @param splits       the active scenario's split rows
 * @param elapsedHrs   hours since the gun
 * @param actualMile   current mile, or null if unknown
 * @param cutoffFor    (stationName) => {cutoffElapsed, cut} | null
 * @param gateHours    the plan's pre-committed "more than N hours behind" trigger
 */
export function project({ splits, elapsedHrs, actualMile, cutoffFor, gateHours = 3 }) {
  const planMileNow = planMileAtElapsed(splits, elapsedHrs);
  const known = typeof actualMile === "number" && actualMile >= 0;

  // Positive delta = behind plan. Without a reported position there is no delta to
  // measure, and assuming zero would quietly turn the plan into a prediction.
  const delta = known ? elapsedHrs - planElapsedAtMile(splits, actualMile) : null;

  const rows = splits
    .filter((s) => !known || s.mile > actualMile)
    .map((s) => {
      const projected = delta == null ? s.elapsed : s.elapsed + delta;
      const c = cutoffFor ? cutoffFor(s.station) : null;
      return {
        station: s.station,
        mile: s.mile,
        planElapsed: s.elapsed,
        planClock: s.clock,
        projectedElapsed: +projected.toFixed(2),
        cutoffElapsed: c ? c.cutoffElapsed : null,
        cut: c ? c.cut : null,
        // Margin against the projection, not against the plan — the number that
        // matters is how much room is left from where you actually are.
        margin: c ? +(c.cutoffElapsed - projected).toFixed(2) : null,
        crew: s.crew,
        pacer: s.pacer,
        mandated: s.mandated,
      };
    });

  const next = rows[0] || null;
  const finish = rows.length ? rows[rows.length - 1] : null;

  return {
    elapsedHrs,
    planMileNow: +planMileNow.toFixed(1),
    actualMile: known ? actualMile : null,
    delta: delta == null ? null : +delta.toFixed(2),
    // Ahead of plan is not a problem to solve; behind plan past the gate is.
    behind: delta != null && delta > 0,
    pastGate: delta != null && delta > gateHours,
    gateHours,
    rows,
    next,
    projectedFinish: finish ? finish.projectedElapsed : null,
    cutoffMargin: finish && finish.margin != null ? finish.margin : null,
    // The tightest point ahead, which is rarely the finish.
    tightest: rows.reduce((acc, r) => (r.margin != null && (!acc || r.margin < acc.margin) ? r : acc), null),
  };
}

/** Elapsed hours from the official gun to `now`, negative before the start. */
export function elapsedSinceStart(now = new Date()) {
  return (now.getTime() - new Date(RACE.start).getTime()) / 3600e3;
}

/** Format hours as "26h 30m", or "—" when absent. */
export function hm(hours) {
  if (hours == null || Number.isNaN(hours)) return "—";
  const sign = hours < 0 ? "-" : "";
  const a = Math.abs(hours);
  const h = Math.floor(a);
  const m = Math.round((a - h) * 60);
  return m === 60 ? `${sign}${h + 1}h 00m` : `${sign}${h}h ${String(m).padStart(2, "0")}m`;
}

/** Google and Apple links for a coordinate. Both open the native app on a phone. */
export function driveLinks(lat, lon, label) {
  const q = `${lat},${lon}`;
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`,
    apple: `https://maps.apple.com/?daddr=${q}&dirflg=d`,
    // A leg link is more useful to a crew chief than a single destination, since
    // the question is almost always "from where I am now to the next stop".
    leg: (fromLat, fromLon) =>
      `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLon}&destination=${q}&travelmode=driving`,
    label: label || q,
  };
}
