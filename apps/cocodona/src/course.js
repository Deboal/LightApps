// course.js — Cocodona 250 course data and the rules derived from it.
//
// PROVENANCE: every number below is official 2026 Aravaipa data, transcribed from
// the handoff package's aid-stations-2026.csv. The 2027 runner manual has not
// published. The owl-habitat closures that drive the three mandatory-solo sections
// are permit-driven and can move year to year; a change there shifts the entire
// pacer hand-off grid. Nothing here should reach a pacer as settled fact without a
// re-check against the 2027 manual. See VERIFY flags below.

export const RACE = {
  name: "Cocodona 250",
  from: "Black Canyon City, AZ",
  to: "Flagstaff, AZ (Heritage Square)",
  start: "2027-05-03T05:00:00-07:00", // Monday May 3, 2027, 5:00 AM
  cutoffHours: 125,                   // absolute: Saturday 10:00 AM
  miles: 252.9,
  gain: 38791,
  loss: 33884,
  startElevation: 1950, // Black Canyon City, approximate. Anchors the derived profile.
  dataYear: 2026,
  runner: "Alex",
  crewChief: "Jackie",
};

// Aid stations in course order. `mile` is cumulative; `gain`/`loss` are for the
// segment ENDING at this station.
//
//   crew     — can a crew vehicle reach this station
//   swap     — can pacers be exchanged here (NOT the same as "a pacer is legal here")
//   drop     — drop bag available
//   sleep    — sleep facility, and what kind
//   verify   — fields flagged unverified for 2027
export const STATIONS = [
  { name: "Cottonwood Creek",      mile: 7.4,   gain: 1423, loss: 1339, crew: false, swap: false, drop: false, sleep: null },
  { name: "Lane Mountain",         mile: 32.5,  gain: 9518, loss: 4856, crew: false, swap: false, drop: false, sleep: null },
  { name: "Crown King",            mile: 36.6,  gain: 338,  loss: 1304, crew: true,  swap: false, drop: true,  sleep: null, note: "First crew access of the race", gearCheck: true },
  { name: "Arrastra Creek",        mile: 51.0,  gain: 2005, loss: 2524, crew: false, swap: false, drop: false, sleep: null },
  { name: "Kamp Kipa",             mile: 60.8,  gain: 3012, loss: 841,  crew: false, swap: false, drop: true,  sleep: null },
  { name: "Camp Wamatochick",      mile: 67.4,  gain: 481,  loss: 1503, crew: false, swap: false, drop: true,  sleep: "Heated bunks" },
  { name: "Whiskey Row (Prescott)",mile: 75.7,  gain: 438,  loss: 1491, crew: true,  swap: false, drop: true,  sleep: "Heated indoor cots" },
  { name: "Watson Lake",           mile: 82.8,  gain: 458,  loss: 558,  crew: true,  swap: true,  drop: false, sleep: null, note: "PACERS START HERE — first legal pacer point" },
  { name: "Fain Ranch",            mile: 94.5,  gain: 735,  loss: 944,  crew: true,  swap: true,  drop: true,  sleep: null, gearCheck: true },
  { name: "Mingus Mountain Camp",  mile: 106.8, gain: 2862, loss: 284,  crew: true,  swap: true,  drop: true,  sleep: "Heated bunks + showers" },
  { name: "Jerome",                mile: 123.8, gain: 1750, loss: 4428, crew: true,  swap: true,  drop: false, sleep: null },
  { name: "Dead Horse Ranch",      mile: 132.5, gain: 356,  loss: 1976, crew: true,  swap: true,  drop: true,  sleep: "Sleeper tents (BYO bag)" },
  { name: "Deer Pass",             mile: 146.5, gain: 1651, loss: 971,  crew: false, swap: false, drop: true,  sleep: null, note: "No crew in 2026 — creates the long crewless stretch" },
  { name: "Sedona Posse Grounds",  mile: 158.8, gain: 1815, loss: 1282, crew: true,  swap: true,  drop: true,  sleep: "Indoor cots", gearCheck: true },
  { name: "Schnebly Hill",         mile: 175.7, gain: 3580, loss: 1628, crew: true,  swap: true,  drop: true,  sleep: null },
  { name: "Munds Park",            mile: 189.6, gain: 1136, loss: 1159, crew: true,  swap: true,  drop: true,  sleep: "Unheated tents w/ cots", gearCheck: true },
  { name: "Kelly Canyon",          mile: 202.3, gain: 999,  loss: 573,  crew: false, swap: false, drop: false, sleep: null },
  { name: "Fort Tuthill",          mile: 210.6, gain: 708,  loss: 610,  crew: true,  swap: true,  drop: true,  sleep: "Heated indoor cots", note: "Mental status evaluation here" },
  { name: "Walnut Canyon",         mile: 226.8, gain: 1419, loss: 1649, crew: true,  swap: true,  drop: true,  sleep: null, verify: ["crew", "drop"] },
  { name: "Wildcat Hill",          mile: 233.7, gain: 469,  loss: 456,  crew: true,  swap: false, drop: true,  sleep: null, gearCheck: true, note: "Last crew point. Jackie's go/no-go gate." },
  { name: "Trinity Heights",       mile: 249.0, gain: 3386, loss: 3055, crew: false, swap: false, drop: false, sleep: null, note: "Mt. Elden: +3,386 up, -3,055 down" },
  { name: "Finish (Heritage Square)", mile: 252.9, gain: 252, loss: 453, crew: true, swap: false, drop: false, sleep: null },
];

// ---------------------------------------------------------------------------
// Pacer legality. This is the distinction the whole app hangs on:
//
//   LEGAL   — race rules permit a pacer on this stretch of trail
//   SWAP    — you can physically exchange pacers at this station (needs crew access)
//   SOLO    — the plan runs it alone, either because rules forbid a pacer
//             (mandated) or because no swap point exists and one pacer would have
//             to cover too much ground (by choice)
//
// A pacer reading "Deer Pass: no pacer" must not conclude pacers are banned there.
// They are legal. There is simply no way to get one in or out.
// ---------------------------------------------------------------------------

export const PACER_START_MILE = 82.8; // Watson Lake

// Stretches where race rules forbid a pacer outright (2026 owl-habitat closures).
export const SOLO_MANDATED = [
  { fromMile: 0,     toMile: 82.8,  reason: "Pacers not permitted until Watson Lake" },
  { fromMile: 175.7, toMile: 189.6, reason: "Owl-habitat closure: Schnebly Hill to Munds Park" },
  { fromMile: 233.7, toMile: 252.9, reason: "Owl-habitat closure: Wildcat Hill to the finish" },
];

// Is a pacer legal on the segment ending at `mile`? Uses the segment's midpoint so
// a station sitting exactly on a boundary resolves to the stretch it belongs to.
export function pacerLegal(fromMile, toMile) {
  const mid = (fromMile + toMile) / 2;
  return !SOLO_MANDATED.some((s) => mid >= s.fromMile && mid < s.toMile);
}

export function soloReason(fromMile, toMile) {
  const mid = (fromMile + toMile) / 2;
  const hit = SOLO_MANDATED.find((s) => mid >= s.fromMile && mid < s.toMile);
  return hit ? hit.reason : null;
}

// ---------------------------------------------------------------------------
// Derived geometry.
// ---------------------------------------------------------------------------

// Segments, each with its own from/to and the pacer verdict already resolved.
export const SEGMENTS = STATIONS.map((s, i) => {
  const prev = i === 0 ? { name: "Start (Black Canyon City)", mile: 0 } : STATIONS[i - 1];
  const legal = pacerLegal(prev.mile, s.mile);
  return {
    index: i,
    from: prev.name,
    fromMile: prev.mile,
    to: s.name,
    toMile: s.mile,
    miles: +(s.mile - prev.mile).toFixed(1),
    gain: s.gain,
    loss: s.loss,
    pacerLegal: legal,
    soloReason: legal ? null : soloReason(prev.mile, s.mile),
    station: s,
  };
});

// Cumulative elevation at each station node.
//
// DERIVED, NOT SURVEYED. Start elevation plus the running sum of segment
// gain minus loss. It cross-foots to the course totals exactly, but a straight
// line between two station nodes hides every intermediate climb — the real trail
// between Crown King and Arrastra Creek is nothing like a straight line. Use the
// per-segment gain/loss bars to read the actual vertical work.
export const PROFILE = (() => {
  let elev = RACE.startElevation;
  const pts = [{ mile: 0, elev, name: "Start" }];
  for (const s of STATIONS) {
    elev += s.gain - s.loss;
    pts.push({ mile: s.mile, elev: Math.round(elev), name: s.name });
  }
  return pts;
})();

// Sanity check the transcription against the published course totals. Runs at
// import so a typo in the table surfaces immediately rather than silently
// shifting every downstream calculation.
export const CHECKSUM = (() => {
  const gain = STATIONS.reduce((a, s) => a + s.gain, 0);
  const loss = STATIONS.reduce((a, s) => a + s.loss, 0);
  const miles = STATIONS[STATIONS.length - 1].mile;
  return {
    gain, loss, miles,
    ok: gain === RACE.gain && loss === RACE.loss && miles === RACE.miles,
  };
})();

// Mileage by pacer state, derived rather than asserted. An earlier draft of the
// UI carried a hand-written "102.1 solo miles" that was simply wrong; these are
// computed from the closures so they cannot drift out of agreement with them.
export const SOLO_MANDATED_MILES = +SEGMENTS
  .filter((s) => !s.pacerLegal)
  .reduce((a, s) => a + s.miles, 0).toFixed(1);

export const PACER_LEGAL_MILES = +(RACE.miles - SOLO_MANDATED_MILES).toFixed(1);

export const CREW_STATIONS = STATIONS.filter((s) => s.crew);
export const SWAP_STATIONS = STATIONS.filter((s) => s.swap);
export const SLEEP_STATIONS = STATIONS.filter((s) => s.sleep);
export const VERIFY_FLAGS = STATIONS.filter((s) => s.verify);

export function stationAt(mile) {
  return STATIONS.find((s) => s.mile === mile) || null;
}

// Effort score for distributing a block's planned hours across its segments.
// Flat miles plus a vertical penalty. The weights are a transparent modelling
// choice, not measured data: 1,000 ft of climb costs about as much as 2 flat
// miles, 1,000 ft of descent about half a mile. Only intra-block splits depend on
// this — block totals and the finish time come straight from the plan.
export const EFFORT_UP_PER_KFT = 2.0;
export const EFFORT_DOWN_PER_KFT = 0.5;

export function effort(seg) {
  return seg.miles + (seg.gain / 1000) * EFFORT_UP_PER_KFT + (seg.loss / 1000) * EFFORT_DOWN_PER_KFT;
}
